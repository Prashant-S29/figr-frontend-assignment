// Owns the active preview's lazy Layers tree, per-row attempts, reveal/focus state and panel failure regions; agents own DOM reads and React only renders snapshots.
import type { AgentMessage, HostMessage, Target, TreeNode } from "../../../shared/protocol";
import { runAttempt, type Attempt } from "../core/attempt";
import { registerDevTrigger } from "../core/dev-registry";
import type { FailureTarget } from "../core/fail";
import { guard } from "../core/guard";
import { scopedTimeout } from "../core/schedule";
import { createFailureRegion, type FailureRegion } from "./failure-region";
import { nearestVisibleRow, visibleTreeRows } from "./layers-tree";
import type { SelectionStore } from "./selection";

export type RowLoadState =
  | { readonly kind: "loading"; readonly region: FailureRegion }
  | { readonly kind: "loaded"; readonly children: readonly string[] }
  | { readonly kind: "error"; readonly region: FailureRegion };

export interface LayersSnapshot {
  readonly revision: number;
  readonly screenId: string | null;
  readonly region: FailureRegion | null;
  readonly rootLoading: boolean;
  readonly roots: readonly string[];
  readonly nodes: ReadonlyMap<string, TreeNode>;
  readonly parents: ReadonlyMap<string, string | null>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly rows: ReadonlyMap<string, RowLoadState>;
  readonly expanded: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
  readonly hoveredId: string | null;
  readonly focusedId: string | null;
  readonly scrollId: string | null;
  readonly scrollRevision: number;
  readonly renderError: Error | null;
}

interface PendingChildren {
  readonly parentId: string | null;
  resolve(children: readonly TreeNode[]): void;
  reject(error: unknown): void;
  cancel(): void;
}

interface PendingAncestors {
  readonly elementId: string;
  resolve(path: readonly TreeNode[]): void;
  reject(error: unknown): void;
  cancel(): void;
}

interface RowOwner {
  readonly region: FailureRegion;
  readonly unsubscribe: () => void;
  promise: Promise<boolean> | null;
}

/** Creates one active-preview tree whose row requests remain isolated from the board, Inspector and sibling rows. */
export function createLayers(
  selection: SelectionStore,
  owner: () => FailureTarget,
  send: (screenId: string, message: HostMessage) => void,
  dev: boolean,
) {
  let snapshot: LayersSnapshot = emptySnapshot(0);
  let requestId = 0;
  let selectionToken = "";
  let hoverToken = "";
  let rootAttempt: Attempt | null = null;
  let rootPromise: Promise<boolean> | null = null;
  let revealAttempt: Attempt | null = null;
  let hoverAttempt: Attempt | null = null;
  let failNextParent: string | null = null;
  const readyScreens = new Set<string>();
  const rowOwners = new Map<string, RowOwner>();
  const pendingChildren = new Map<number, PendingChildren>();
  const pendingAncestors = new Map<number, PendingAncestors>();
  const listeners = new Set<() => void>();
  const removeTriggers: (() => void)[] = [];

  /** Builds an inactive immutable panel snapshot while retaining a monotonic render revision. */
  function emptySnapshot(revision: number): LayersSnapshot {
    return {
      revision,
      screenId: null,
      region: null,
      rootLoading: false,
      roots: [],
      nodes: new Map(),
      parents: new Map(),
      children: new Map(),
      rows: new Map(),
      expanded: new Set(),
      selected: new Set(),
      hoveredId: null,
      focusedId: null,
      scrollId: null,
      scrollRevision: 0,
      renderError: null,
    };
  }

  /** Publishes a complete snapshot after store-owned maps and sets have been replaced. */
  function publish(next: LayersSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  /** Reads relationships in the shape shared by visible-row and nearest-ancestor derivations. */
  function relations() {
    return { roots: snapshot.roots, children: snapshot.children, parents: snapshot.parents, expanded: snapshot.expanded };
  }

  /** Cancels request/reveal work and disposes all child regions without touching the current whole-panel region. */
  function clearWork(): void {
    rootAttempt?.cancel();
    revealAttempt?.cancel();
    hoverAttempt?.cancel();
    rootAttempt = revealAttempt = hoverAttempt = null;
    rootPromise = null;
    for (const pending of pendingChildren.values()) pending.cancel();
    for (const pending of pendingAncestors.values()) pending.cancel();
    pendingChildren.clear();
    pendingAncestors.clear();
    for (const row of rowOwners.values()) {
      row.unsubscribe();
      row.region.dispose();
    }
    rowOwners.clear();
  }

  /** Replaces the active preview's whole Layers owner, including page-instance-local ids and in-flight replies. */
  function activate(screenId: string | null, force = false): void {
    if (!force && snapshot.screenId === screenId) return;
    clearWork();
    snapshot.region?.dispose();
    selectionToken = hoverToken = "";
    if (screenId === null) {
      publish(emptySnapshot(snapshot.revision + 1));
      return;
    }
    const region = createFailureRegion("layers", { screenId }, owner().ctx.scope);
    publish({ ...emptySnapshot(snapshot.revision + 1), screenId, region, rootLoading: readyScreens.has(screenId) });
    if (readyScreens.has(screenId)) loadRoot();
  }

  /** Reuses one pending request per parent and attributes its three-second timeout to the supplied region. */
  function requestChildren(parentId: string | null, target: FailureTarget, signal: AbortSignal): Promise<readonly TreeNode[]> {
    if (parentId !== null && failNextParent === parentId) {
      failNextParent = null;
      return Promise.reject(new Error("Couldn't load"));
    }
    /** Registers one correlated child request and removes all native work before either settlement path. */
    function create(resolve: (children: readonly TreeNode[]) => void, reject: (error: unknown) => void): void {
      const correlation = ++requestId;
      let settled = false;
      /** Removes timeout and abort bookkeeping exactly once before settling the request. */
      function cleanup(): void {
        if (settled) return;
        settled = true;
        cancelTimeout();
        signal.removeEventListener("abort", abort);
        pendingChildren.delete(correlation);
      }
      /** Resolves only the matching live parent response. */
      function complete(children: readonly TreeNode[]): void { cleanup(); resolve(children); }
      /** Rejects malformed, timed-out or cancelled work under its original row owner. */
      function failRequest(error: unknown): void { cleanup(); reject(error); }
      /** Makes replaced row work silent through runAttempt's dead child scope. */
      function abort(): void { failRequest(new DOMException("Aborted", "AbortError")); }
      const cancelTimeout = scopedTimeout(target, () => failRequest(new Error("Couldn't load")), 3_000);
      pendingChildren.set(correlation, { parentId, resolve: complete, reject: failRequest, cancel: abort });
      signal.addEventListener("abort", abort, { once: true });
      send(snapshot.screenId!, { type: "tree-children", requestId: correlation, parentElementId: parentId });
    }
    return new Promise(create);
  }

  /** Correlates ancestor discovery separately from row loads so hover/reveal cancellation cannot consume a child reply. */
  function requestAncestors(elementId: string, target: FailureTarget, signal: AbortSignal): Promise<readonly TreeNode[]> {
    /** Registers one correlated ancestry request whose cancellation cannot consume a future selection's response. */
    function create(resolve: (path: readonly TreeNode[]) => void, reject: (error: unknown) => void): void {
      const correlation = ++requestId;
      let settled = false;
      /** Removes timeout and abort bookkeeping exactly once before settling the request. */
      function cleanup(): void {
        if (settled) return;
        settled = true;
        cancelTimeout();
        signal.removeEventListener("abort", abort);
        pendingAncestors.delete(correlation);
      }
      /** Resolves only a path ending at the requested current identity. */
      function complete(path: readonly TreeNode[]): void { cleanup(); resolve(path); }
      /** Rejects invalid, timed-out or cancelled discovery under the whole Layers owner. */
      function failRequest(error: unknown): void { cleanup(); reject(error); }
      /** Makes replaced selection discovery silent. */
      function abort(): void { failRequest(new DOMException("Aborted", "AbortError")); }
      const cancelTimeout = scopedTimeout(target, () => failRequest(new Error("Couldn't load")), 3_000);
      pendingAncestors.set(correlation, { elementId, resolve: complete, reject: failRequest, cancel: abort });
      signal.addEventListener("abort", abort, { once: true });
      send(snapshot.screenId!, { type: "tree-ancestors", requestId: correlation, elementId });
    }
    return new Promise(create);
  }

  /** Merges page-owned row metadata while deriving parent links only from a complete child level. */
  function applyChildren(parentId: string | null, values: readonly TreeNode[]): void {
    const nodes = new Map(snapshot.nodes);
    const parents = new Map(snapshot.parents);
    const children = new Map(snapshot.children);
    const ids = values.map(value => value.elementId);
    for (const value of values) {
      nodes.set(value.elementId, value);
      parents.set(value.elementId, parentId);
    }
    if (parentId !== null) children.set(parentId, ids);
    publish({ ...snapshot, nodes, parents, children, roots: parentId === null ? ids : snapshot.roots });
  }

  /** Adds ancestor metadata and links without pretending that an unrequested sibling level is complete. */
  function applyPath(path: readonly TreeNode[]): void {
    const nodes = new Map(snapshot.nodes);
    const parents = new Map(snapshot.parents);
    for (let index = 0; index < path.length; index += 1) {
      const value = path[index];
      nodes.set(value.elementId, value);
      parents.set(value.elementId, index ? path[index - 1].elementId : null);
    }
    publish({ ...snapshot, nodes, parents });
  }

  /** Loads the invisible body root once and exposes failures through the whole Layers region. */
  function loadRoot(): Promise<boolean> {
    if (snapshot.roots.length || (rootPromise && rootAttempt)) return rootPromise ?? Promise.resolve(true);
    if (!snapshot.region || !snapshot.screenId || !readyScreens.has(snapshot.screenId)) return Promise.resolve(false);
    const region = snapshot.region;
    publish({ ...snapshot, rootLoading: true });
    /** Requests body children from this exact panel generation. */
    function load(signal: AbortSignal): Promise<readonly TreeNode[]> { return requestChildren(null, region.target, signal); }
    /** Publishes top-level rows only while this active panel still owns the response. */
    function apply(values: readonly TreeNode[]): void {
      if (snapshot.region !== region) return;
      applyChildren(null, values);
      publish({ ...snapshot, rootLoading: false });
    }
    rootAttempt = runAttempt(region.target, load, apply);
    rootPromise = rootAttempt.settled.then(() => snapshot.region === region && !region.getSnapshot().failure && !snapshot.rootLoading);
    return rootPromise;
  }

  /** Creates or reuses one row owner and mirrors its visible failure into the row's exact state. */
  function rowOwner(parentId: string): RowOwner {
    const existing = rowOwners.get(parentId);
    if (existing) return existing;
    const node = snapshot.nodes.get(parentId);
    const region = createFailureRegion("layers-row", { screenId: snapshot.screenId, ...(node?.dataKey !== null && node?.dataKey !== undefined ? { elementKey: node.dataKey } : {}) }, snapshot.region!.target.ctx.scope);
    /** Replaces Loading with Error only for this row while every sibling state remains untouched. */
    function changed(): void {
      const state = region.getSnapshot();
      if (!state.failure || snapshot.screenId === null) return;
      const rows = new Map(snapshot.rows);
      rows.set(parentId, { kind: "error", region });
      publish({ ...snapshot, rows });
    }
    const entry: RowOwner = { region, unsubscribe: region.subscribe(changed), promise: null };
    rowOwners.set(parentId, entry);
    return entry;
  }

  /** Starts at most one child attempt for a row and retains it across collapse/re-expand. */
  function loadRow(parentId: string): Promise<boolean> {
    const current = snapshot.rows.get(parentId);
    if (current?.kind === "loaded") return Promise.resolve(true);
    const entry = rowOwner(parentId);
    if (entry.promise) return entry.promise;
    const rows = new Map(snapshot.rows);
    rows.set(parentId, { kind: "loading", region: entry.region });
    publish({ ...snapshot, rows });
    /** Requests exactly one direct child level for this row. */
    function load(signal: AbortSignal): Promise<readonly TreeNode[]> { return requestChildren(parentId, entry.region.target, signal); }
    /** Atomically replaces Loading with one complete Loaded child list. */
    function apply(values: readonly TreeNode[]): void {
      applyChildren(parentId, values);
      const nextRows = new Map(snapshot.rows);
      nextRows.set(parentId, { kind: "loaded", children: values.map(value => value.elementId) });
      publish({ ...snapshot, rows: nextRows });
    }
    const attempt = runAttempt(entry.region.target, load, apply);
    entry.promise = attempt.settled.then(() => snapshot.rows.get(parentId)?.kind === "loaded");
    /** Releases only this completed attempt so a replacement generation keeps its own single-flight marker. */
    function finished(): void { if (rowOwners.get(parentId) === entry) entry.promise = null; }
    entry.promise.finally(finished);
    return entry.promise;
  }

  /** Loads either the body root or one parent row without duplicating an existing request. */
  function ensureLoaded(parentId: string | null): Promise<boolean> {
    return parentId === null ? loadRoot() : loadRow(parentId);
  }

  /** Reveals one body-relative path level by level, stopping if a mutation makes any requested relation stale. */
  async function revealPath(path: readonly TreeNode[], token: string, expanded: Set<string>): Promise<boolean> {
    applyPath(path);
    for (let index = 0; index < path.length; index += 1) {
      if (selectionToken !== token || snapshot.screenId === null) return false;
      const parentId = index ? path[index - 1].elementId : null;
      if (!await ensureLoaded(parentId)) return false;
      const siblings = parentId === null ? snapshot.roots : snapshot.children.get(parentId) ?? [];
      if (!siblings.includes(path[index].elementId)) return false;
      if (index < path.length - 1) expanded.add(path[index].elementId);
    }
    return true;
  }

  /** Discovers selected paths in parallel, then expands each path while reusing shared ancestor row loads. */
  function reveal(targets: readonly Target[], token: string): void {
    revealAttempt?.cancel();
    if (!snapshot.region || !targets.length) return;
    const region = snapshot.region;
    /** Requests all independent ancestor paths without a discovery waterfall. */
    function load(signal: AbortSignal): Promise<readonly (readonly TreeNode[])[]> {
      return Promise.all(targets.map(target => requestAncestors(target.elementId, region.target, signal)));
    }
    /** Expands current paths and scrolls only the most-recent selected row into the panel. */
    function apply(paths: readonly (readonly TreeNode[])[]): void {
      /** Loads shared ancestor levels, then publishes one atomic expansion and final panel scroll. */
      async function expandPaths(): Promise<void> {
        const expanded = new Set(snapshot.expanded);
        const results = await Promise.all(paths.map(path => revealPath(path, token, expanded)));
        if (selectionToken !== token || !results.every(Boolean)) return;
        const focusedId = targets[targets.length - 1].elementId;
        publish({ ...snapshot, expanded, focusedId, scrollId: focusedId, scrollRevision: snapshot.scrollRevision + 1 });
      }
      guard(region.target, expandPaths)();
    }
    revealAttempt = runAttempt(region.target, load, apply);
  }

  /** Resolves an unknown preview hover to a visible row or nearest collapsed ancestor without expanding anything. */
  function discoverHover(target: Target, token: string): void {
    hoverAttempt?.cancel();
    if (!snapshot.region) return;
    const region = snapshot.region;
    /** Loads only ancestry metadata for the current stationary hover. */
    function load(signal: AbortSignal): Promise<readonly TreeNode[]> { return requestAncestors(target.elementId, region.target, signal); }
    /** Publishes the nearest row only if the same hover still owns the result. */
    function apply(path: readonly TreeNode[]): void {
      if (hoverToken !== token || !path.length) return;
      applyPath(path);
      publish({ ...snapshot, hoveredId: nearestVisibleRow(target.elementId, relations()) });
    }
    hoverAttempt = runAttempt(region.target, load, apply);
  }

  /** Mirrors active preview, selected rows and hover proxy from the sole host selection owner. */
  function synchronizeSelection(): void {
    const selected = selection.getSnapshot();
    if (selected.activeScreenId !== snapshot.screenId) activate(selected.activeScreenId);
    if (!snapshot.screenId) return;
    const selectedTargets = selected.screenId === snapshot.screenId ? selected.targets : [];
    const nextSelectionToken = `${snapshot.screenId}|${selectedTargets.map(item => item.elementId).join(",")}`;
    const nextHover = selected.hover?.screenId === snapshot.screenId ? selected.hover.target : null;
    const nextHoverToken = nextHover ? `${snapshot.screenId}|${nextHover.elementId}` : "";
    const selectedIds = new Set(selectedTargets.map(item => item.elementId));
    const hoveredId = nextHover ? nearestVisibleRow(nextHover.elementId, relations()) : null;
    publish({ ...snapshot, selected: selectedIds, hoveredId });
    if (nextSelectionToken !== selectionToken) {
      selectionToken = nextSelectionToken;
      revealAttempt?.cancel();
      if (selectedTargets.length) {
        const allVisible = selectedTargets.every(target => nearestVisibleRow(target.elementId, relations()) === target.elementId);
        if (allVisible) {
          const focusedId = selectedTargets[selectedTargets.length - 1].elementId;
          publish({ ...snapshot, focusedId, scrollId: focusedId, scrollRevision: snapshot.scrollRevision + 1 });
        } else reveal(selectedTargets, selectionToken);
      }
    }
    if (nextHoverToken !== hoverToken) {
      hoverToken = nextHoverToken;
      hoverAttempt?.cancel();
      if (nextHover && hoveredId === null) discoverHover(nextHover, hoverToken);
    }
  }

  /** Applies a correlated direct-child response or rejects it into that row's existing attempt. */
  function receiveChildren(message: Extract<AgentMessage, { type: "tree-children-result" }>): void {
    const pending = pendingChildren.get(message.requestId);
    if (!pending) return;
    if (pending.parentId !== message.parentElementId) pending.reject(new Error("Tree children response mismatch"));
    else pending.resolve(message.children);
  }

  /** Applies a correlated path only when it ends at the identity that requested it. */
  function receiveAncestors(message: Extract<AgentMessage, { type: "tree-ancestors-result" }>): void {
    const pending = pendingAncestors.get(message.requestId);
    if (!pending) return;
    if (!message.path.length || message.path[message.path.length - 1].elementId !== pending.elementId) pending.reject(new Error("Tree ancestors response mismatch"));
    else pending.resolve(message.path);
  }

  /** Routes only current active-preview tree replies; stale page-instance replies remain silent. */
  function receive(screenId: string, message: AgentMessage): void {
    if (screenId !== snapshot.screenId) return;
    if (message.type === "tree-children-result") receiveChildren(message);
    else if (message.type === "tree-ancestors-result") receiveAncestors(message);
  }

  /** Marks a connected page ready and starts a deferred active root load. */
  function ready(screenId: string): void {
    readyScreens.add(screenId);
    if (snapshot.screenId === screenId && !snapshot.roots.length && !rootAttempt) loadRoot();
  }

  /** Drops one replaced document's ids and requests while preserving the active-preview choice for its next ready instance. */
  function forget(screenId: string): void {
    readyScreens.delete(screenId);
    if (snapshot.screenId !== screenId) return;
    clearWork();
    snapshot.region?.dispose();
    const region = createFailureRegion("layers", { screenId }, owner().ctx.scope);
    selectionToken = hoverToken = "";
    publish({ ...emptySnapshot(snapshot.revision + 1), screenId, region });
  }

  /** Expands a child-bearing row on first use or collapses it without cancelling its reusable in-flight request. */
  function toggle(elementId: string): void {
    const node = snapshot.nodes.get(elementId);
    if (!node?.hasChildren) return;
    const expanded = new Set(snapshot.expanded);
    if (expanded.has(elementId)) expanded.delete(elementId);
    else {
      expanded.add(elementId);
      loadRow(elementId);
    }
    publish({ ...snapshot, expanded, focusedId: elementId });
  }

  /** Restarts only one failed row after RegionBoundary has created its fresh retry generation. */
  function retryRow(elementId: string): void { loadRow(elementId); }

  /** Selects a row through the shared selection owner and scrolls only that iframe document to it. */
  function selectRow(elementId: string, shift: boolean): void {
    if (!snapshot.screenId) return;
    const node = snapshot.nodes.get(elementId);
    if (!node) return;
    publish({ ...snapshot, focusedId: elementId });
    selection.select(snapshot.screenId, node, shift);
    send(snapshot.screenId, { type: "scroll-element", elementId });
  }

  /** Makes row hover the one global hover source, so preview movement can replace it naturally. */
  function hoverRow(elementId: string | null): void {
    if (!snapshot.screenId) return;
    const node = elementId ? snapshot.nodes.get(elementId) : null;
    selection.hover(snapshot.screenId, node ?? null, "layers");
  }

  /** Moves tree focus or expands/collapses according to the PRD's panel arrow-key model. */
  function key(key: string): void {
    const visible = visibleTreeRows(relations());
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex(row => row.elementId === snapshot.focusedId));
    const currentId = visible[index].elementId;
    if (key === "ArrowDown") publish({ ...snapshot, focusedId: visible[Math.min(index + 1, visible.length - 1)].elementId });
    else if (key === "ArrowUp") publish({ ...snapshot, focusedId: visible[Math.max(index - 1, 0)].elementId });
    else if (key === "ArrowRight") {
      const node = snapshot.nodes.get(currentId);
      if (!node?.hasChildren) return;
      if (!snapshot.expanded.has(currentId)) toggle(currentId);
      else {
        const first = snapshot.children.get(currentId)?.[0];
        if (first) publish({ ...snapshot, focusedId: first });
      }
    } else if (key === "ArrowLeft") {
      if (snapshot.expanded.has(currentId)) toggle(currentId);
      else {
        const parentId = snapshot.parents.get(currentId);
        if (parentId) publish({ ...snapshot, focusedId: parentId });
      }
    }
  }

  /** Aligns store-owned keyboard position when a row receives focus by click or direct tab movement. */
  function focusRow(elementId: string): void {
    if (snapshot.focusedId !== elementId && snapshot.nodes.has(elementId)) publish({ ...snapshot, focusedId: elementId });
  }

  /** Initializes focus when keyboard users enter a nonempty panel without a current row. */
  function focusFirst(): void {
    if (snapshot.focusedId) return;
    const first = visibleTreeRows(relations())[0];
    if (first) publish({ ...snapshot, focusedId: first.elementId });
  }

  /** Rebuilds panel-owned child regions and root data after a whole-Layers Retry. */
  function retryLayers(): void {
    const screenId = snapshot.screenId;
    const region = snapshot.region;
    if (!screenId || !region) return;
    clearWork();
    selectionToken = hoverToken = "";
    publish({ ...emptySnapshot(snapshot.revision + 1), screenId, region, rootLoading: readyScreens.has(screenId) });
    if (readyScreens.has(screenId)) loadRoot();
    synchronizeSelection();
  }

  /** Forces the next request for one expandable row through its real isolated failure path. */
  function injectRowFailure(): void {
    const node = visibleTreeRows(relations()).map(row => snapshot.nodes.get(row.elementId)).find(value => value?.hasChildren);
    if (!node) return;
    const prior = rowOwners.get(node.elementId);
    if (prior) {
      prior.unsubscribe();
      prior.region.dispose();
      rowOwners.delete(node.elementId);
    }
    const rows = new Map(snapshot.rows);
    rows.delete(node.elementId);
    const children = new Map(snapshot.children);
    children.delete(node.elementId);
    const expanded = new Set(snapshot.expanded);
    expanded.add(node.elementId);
    failNextParent = node.elementId;
    publish({ ...snapshot, rows, children, expanded });
    loadRow(node.elementId);
  }

  /** Throws from the actual Layers render path while retaining board and Inspector state. */
  function injectRenderFailure(): void { publish({ ...snapshot, renderError: new Error("Layers render failure") }); }

  /** Supplies the current whole-panel owner to dev trigger guards. */
  function layersTarget(): FailureTarget { return snapshot.region?.target ?? owner(); }

  if (dev) {
    removeTriggers.push(
      registerDevTrigger({ id: "layers-row-fail", label: "Layers row load fails", target: layersTarget, run: injectRowFailure }),
      registerDevTrigger({ id: "layers-render", label: "Layers render fails", target: layersTarget, run: injectRenderFailure }),
    );
  }

  const unsubscribeSelection = selection.subscribe(synchronizeSelection);
  synchronizeSelection();

  /** Reads one immutable panel projection for React and failure boundaries. */
  function getSnapshot(): LayersSnapshot { return snapshot; }

  /** Registers a Layers view without exposing tree mutation. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Removes only this panel reader. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }

  /** Cancels every panel/reply lifetime and dev registration with the board generation. */
  function dispose(): void {
    unsubscribeSelection();
    clearWork();
    snapshot.region?.dispose();
    for (const remove of removeTriggers) remove();
    listeners.clear();
  }

  return { getSnapshot, subscribe, receive, ready, forget, toggle, retryRow, retryLayers, selectRow, hoverRow, key, focusRow, focusFirst, dispose };
}

export type LayersStore = ReturnType<typeof createLayers>;
