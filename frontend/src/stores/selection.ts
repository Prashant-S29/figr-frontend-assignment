// Owns global hover, ordered single-preview selection and rAF-batched geometry; agents own nodes and React owns no shared inspection state.
import type { Direction, Geometry, HostMessage, Target } from "../../../shared/protocol";
import type { FailureTarget } from "../core/fail";
import { scopedFrame } from "../core/schedule";

export interface Hover { readonly screenId: string; readonly target: Target }
export interface SelectionSnapshot {
  readonly activeScreenId: string | null;
  readonly hover: Hover | null;
  readonly screenId: string | null;
  readonly targets: readonly Target[];
  readonly geometry: ReadonlyMap<string, ReadonlyMap<string, Geometry>>;
  readonly drawFault: { readonly screenId: string; readonly error: Error } | null;
}
interface Tracking { revision: number; ids: readonly string[] }

/** Creates host-owned inspection state with revisioned tracking and serialized keyboard traversal, never sibling-index matching. */
export function createSelection(target: () => FailureTarget, send: (screenId: string, message: HostMessage) => void) {
  let snapshot: SelectionSnapshot = { activeScreenId: null, hover: null, screenId: null, targets: [], geometry: new Map(), drawFault: null };
  const listeners = new Set<() => void>();
  const tracking = new Map<string, Tracking>();
  const arrivals = new Map<string, { revision: number; targets: readonly Geometry[] }>();
  let revision = 0;
  let requestId = 0;
  let pending: { screenId: string; requestId: number } | null = null;
  let queue: Direction[] = [];
  let cancelFrame: (() => void) | undefined;

  /** Publishes already-replaced snapshots to external readers. */
  function notify(): void { for (const listener of listeners) listener(); }
  /** Cancels traversal intents when the user explicitly replaces, clears or toggles the selection context. */
  function cancelNavigation(): void { pending = null; queue = []; }
  /** Replaces exact tracked sets and discards geometry for identities that are no longer hovered or selected. */
  function synchronize(): void {
    const desired = new Map<string, string[]>();
    if (snapshot.screenId && snapshot.targets.length) desired.set(snapshot.screenId, snapshot.targets.map(item => item.elementId));
    if (snapshot.hover) {
      const { screenId, target } = snapshot.hover;
      const ids = desired.get(screenId) ?? [];
      if (!ids.includes(target.elementId)) ids.push(target.elementId);
      desired.set(screenId, ids);
    }
    const geometry = new Map(snapshot.geometry);
    const screens = new Set([...tracking.keys(), ...desired.keys()]);
    for (const screenId of screens) {
      const ids = desired.get(screenId) ?? [];
      const previous = tracking.get(screenId);
      if (previous && previous.ids.length === ids.length && previous.ids.every(id => ids.includes(id))) continue;
      const next = { revision: ++revision, ids };
      tracking.set(screenId, next);
      arrivals.delete(screenId);
      const measured = geometry.get(screenId);
      if (measured) geometry.set(screenId, new Map([...measured].filter(([id]) => ids.includes(id))));
      send(screenId, { type: "track", revision: next.revision, elementIds: ids });
    }
    snapshot = { ...snapshot, geometry };
  }
  /** Changes only the global hovered identity; a null from an old preview cannot clear a newer preview's hover. */
  function hover(screenId: string, value: Target | null): void {
    if (!value && snapshot.hover?.screenId !== screenId) return;
    if (value && snapshot.hover?.screenId === screenId && snapshot.hover.target.elementId === value.elementId) return;
    snapshot = { ...snapshot, hover: value ? { screenId, target: value } : null };
    synchronize();
    notify();
  }
  /** Removes transient hover without dropping selected geometry or keyboard ordering. */
  function clearHover(): void {
    if (!snapshot.hover) return;
    hover(snapshot.hover.screenId, null);
  }
  /** Applies click/shift-click replacement or toggling, retaining selection order for the most-recent keyboard target. */
  function select(screenId: string, value: Target | null, shift: boolean): void {
    cancelNavigation();
    let targets: readonly Target[] = value ? [value] : [];
    if (value && shift && snapshot.screenId === screenId) {
      targets = snapshot.targets.some(item => item.elementId === value.elementId)
        ? snapshot.targets.filter(item => item.elementId !== value.elementId) : [...snapshot.targets, value];
    }
    snapshot = { ...snapshot, activeScreenId: screenId, screenId: targets.length ? screenId : null, targets };
    synchronize();
    notify();
  }
  /** Clears selection while preserving the last active preview and any genuine pointer hover. */
  function clear(): void {
    cancelNavigation();
    snapshot = { ...snapshot, screenId: null, targets: [] };
    synchronize();
    notify();
  }
  /** Starts the next queued relation from the latest result, so rapid Tab presses cannot reuse an obsolete starting element. */
  function advance(): void {
    if (pending || !queue.length || !snapshot.screenId || !snapshot.targets.length) return;
    const direction = queue.shift()!;
    pending = { screenId: snapshot.screenId, requestId: ++requestId };
    send(pending.screenId, { type: "navigate", requestId, elementId: snapshot.targets[snapshot.targets.length - 1].elementId, direction });
  }
  /** Enqueues a single keyboard intent; the agent resolves the relation, but the host decides selection state. */
  function navigate(direction: Direction): void { if (!snapshot.targets.length) return; queue.push(direction); advance(); }
  /** Applies only the matching live traversal reply and replaces multi-selection with its result. */
  function navigationResult(screenId: string, correlation: number, value: Target | null): void {
    if (!pending || pending.screenId !== screenId || pending.requestId !== correlation) return;
    pending = null;
    if (value) {
      snapshot = { ...snapshot, screenId, targets: [value] };
      synchronize();
      notify();
    }
    advance();
  }
  /** Publishes only the latest still-tracked measurement per screen at most once per host animation frame. */
  function flush(): void {
    cancelFrame = undefined;
    const geometry = new Map(snapshot.geometry);
    for (const [screenId, arrival] of arrivals) {
      if (tracking.get(screenId)?.revision === arrival.revision) geometry.set(screenId, new Map(arrival.targets.map(item => [item.elementId, item])));
    }
    arrivals.clear();
    snapshot = { ...snapshot, geometry };
    notify();
  }
  /** Rejects unsolicited tracked identities while silently ignoring replaced-revision responses. */
  function receiveGeometry(screenId: string, version: number, targets: readonly Geometry[]): void {
    const expected = tracking.get(screenId);
    if (!expected || expected.revision !== version) return;
    if (targets.length !== expected.ids.length || targets.some(item => !expected.ids.includes(item.elementId))) throw new Error("Geometry tracking mismatch");
    arrivals.set(screenId, { revision: version, targets });
    if (!cancelFrame) cancelFrame = scopedFrame(target(), flush);
  }
  /** Removes references owned by a replaced/failed document without guessing a new binding. */
  function forget(screenId: string): void {
    if (pending?.screenId === screenId) cancelNavigation();
    tracking.delete(screenId);
    arrivals.delete(screenId);
    const geometry = new Map(snapshot.geometry);
    geometry.delete(screenId);
    snapshot = { ...snapshot, geometry,
      hover: snapshot.hover?.screenId === screenId ? null : snapshot.hover,
      screenId: snapshot.screenId === screenId ? null : snapshot.screenId,
      targets: snapshot.screenId === screenId ? [] : snapshot.targets,
      drawFault: snapshot.drawFault?.screenId === screenId ? null : snapshot.drawFault };
    notify();
  }
  /** Exercises preview drawing on its original connection scope; replacement before the frame is silent. */
  function injectDrawFault(screenId: string, owner: FailureTarget): void {
    /** Publishes a fresh drawing occurrence; the drawing view routes it to that preview's region. */
    function inject(): void { snapshot = { ...snapshot, drawFault: { screenId, error: new Error("Outline drawing failure") } }; notify(); }
    scopedFrame(owner, inject);
  }
  /** Silences queued geometry and resets all document-owned inspection state on board Retry. */
  function reset(): void {
    cancelFrame?.();
    cancelFrame = undefined;
    cancelNavigation();
    tracking.clear();
    arrivals.clear();
    snapshot = { activeScreenId: null, hover: null, screenId: null, targets: [], geometry: new Map(), drawFault: null };
    notify();
  }
  /** Reads a stable snapshot; DOM nodes never appear in it. */
  function getSnapshot(): SelectionSnapshot { return snapshot; }
  /** Subscribes an inspection view to store-owned actions and batched geometry. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Detaches this inspection reader. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }
  /** Disposes pending drawing work and readers without publishing into a removed host. */
  function dispose(): void { reset(); listeners.clear(); }
  return { getSnapshot, subscribe, hover, clearHover, select, clear, navigate, navigationResult, cancelNavigation, receiveGeometry, forget, injectDrawFault, reset, dispose };
}
export type SelectionStore = ReturnType<typeof createSelection>;
