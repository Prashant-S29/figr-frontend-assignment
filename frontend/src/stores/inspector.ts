// Owns Inspector selection projection, Details request lifetime and inspector/details failure regions; the agent owns Live DOM reads and React only renders snapshots.
import type { LiveData } from "../../../shared/protocol";
import { fetchElementDetails, type ElementDetails, type ElementDetailsQuery } from "../api/elements";
import { runAttempt } from "../core/attempt";
import { registerDevTrigger } from "../core/dev-registry";
import type { FailureTarget } from "../core/fail";
import { createFailureRegion, type FailureRegion } from "./failure-region";
import type { SelectionStore } from "./selection";

export interface InspectorLive extends LiveData {
  readonly elementId: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
}
export type DetailsState =
  | { readonly kind: "hidden" }
  | { readonly kind: "loading" }
  | { readonly kind: "none" }
  | { readonly kind: "not-found" }
  | { readonly kind: "found"; readonly details: ElementDetails };
export interface InspectorSnapshot {
  readonly revision: number;
  readonly screenId: string | null;
  readonly count: number;
  readonly missing: boolean;
  readonly live: readonly InspectorLive[] | null;
  readonly details: DetailsState;
  readonly region: FailureRegion | null;
  readonly detailsRegion: FailureRegion | null;
  readonly renderError: Error | null;
}

/** Creates selection-scoped Live/Details state whose replaced requests and regions are cancelled before newer values publish. */
export function createInspector(selection: SelectionStore, owner: () => FailureTarget, dev: boolean, query: ElementDetailsQuery) {
  let snapshot: InspectorSnapshot = {
    revision: 0,
    screenId: null,
    count: 0,
    missing: false,
    live: [],
    details: { kind: "hidden" },
    region: null,
    detailsRegion: null,
    renderError: null,
  };
  let selectionToken = "";
  let detailsToken: string | null = null;
  let detailsKey: string | null = null;
  let failNextDetails = false;
  const listeners = new Set<() => void>();
  const removeTriggers: (() => void)[] = [];

  /** Publishes a complete inspector snapshot to views without exposing request mutation. */
  function publish(next: InspectorSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  /** Reads current selected Live values only when every selected identity has a connected measurement. */
  function readLive(): readonly InspectorLive[] | null {
    const selected = selection.getSnapshot();
    if (!selected.targets.length) return [];
    if (!selected.screenId) return null;
    const measured = selected.geometry.get(selected.screenId);
    const values: InspectorLive[] = [];
    for (const target of selected.targets) {
      const geometry = measured?.get(target.elementId);
      if (!geometry?.box || !geometry.live) return null;
      values.push({ ...geometry.live, elementId: target.elementId, name: geometry.name, width: geometry.box.width, height: geometry.box.height });
    }
    return values;
  }

  /** Disposes the prior Details owner before clearing all request correlation state. */
  function disposeDetails(): void {
    snapshot.detailsRegion?.dispose();
    detailsToken = null;
    detailsKey = null;
  }

  /** Applies only a response belonging to the currently visible Details region. */
  function applyDetails(region: FailureRegion, result: Awaited<ReturnType<typeof fetchElementDetails>>): void {
    if (snapshot.detailsRegion !== region) return;
    publish({ ...snapshot, details: result.kind === "not-found" ? { kind: "not-found" } : { kind: "found", details: result.details } });
  }

  /** Starts one cancellable request in the current Details retry generation. */
  function loadDetails(): void {
    const currentRegion = snapshot.detailsRegion;
    const currentKey = detailsKey;
    if (currentRegion === null || currentKey === null) return;
    const region: FailureRegion = currentRegion;
    const key: string = currentKey;
    const forcedFailure = failNextDetails;
    failNextDetails = false;
    publish({ ...snapshot, details: { kind: "loading" } });
    /** Fetches the current key with URL verification controls and one-shot dev failure injection. */
    function request(signal: AbortSignal) {
      return fetchElementDetails(key, signal, { latency: query.latency, fail: forcedFailure || query.fail });
    }
    /** Publishes only through this exact still-current region. */
    function apply(result: Awaited<ReturnType<typeof fetchElementDetails>>): void { applyDetails(region, result); }
    runAttempt(region.target, request, apply);
  }

  /** Creates, removes or retains Details work according to the latest complete single-selection Live value. */
  function synchronizeDetails(): void {
    if (snapshot.count !== 1) {
      disposeDetails();
      snapshot = { ...snapshot, details: { kind: "hidden" }, detailsRegion: null };
      return;
    }
    const value = snapshot.live?.[0];
    if (!value) {
      if (!snapshot.detailsRegion) snapshot = { ...snapshot, details: { kind: "loading" } };
      return;
    }
    if (value.dataKey === null) {
      disposeDetails();
      snapshot = { ...snapshot, details: { kind: "none" }, detailsRegion: null };
      return;
    }
    const token = `${snapshot.screenId}:${value.elementId}:${value.dataKey}`;
    if (detailsToken === token && snapshot.detailsRegion) return;
    disposeDetails();
    const region = createFailureRegion("details", { screenId: snapshot.screenId, elementKey: value.dataKey }, owner().ctx.scope);
    detailsToken = token;
    detailsKey = value.dataKey;
    snapshot = { ...snapshot, details: { kind: "loading" }, detailsRegion: region };
    loadDetails();
  }

  /** Replaces selection-scoped regions immediately, then refreshes Live data as geometry frames arrive. */
  function synchronize(): void {
    const selected = selection.getSnapshot();
    const token = `${selected.activeScreenId ?? ""}|${selected.screenId ?? ""}|${selected.targets.map(item => item.elementId).join(",")}|${selected.missing}`;
    const changed = token !== selectionToken;
    if (changed) {
      snapshot.region?.dispose();
      disposeDetails();
      selectionToken = token;
      failNextDetails = false;
      const screenId = selected.screenId ?? selected.activeScreenId;
      const region = screenId ? createFailureRegion("inspector", { screenId }, owner().ctx.scope) : null;
      snapshot = {
        revision: snapshot.revision + 1,
        screenId,
        count: selected.targets.length,
        missing: selected.missing,
        live: readLive(),
        details: selected.targets.length === 1 ? { kind: "loading" } : { kind: "hidden" },
        region,
        detailsRegion: null,
        renderError: null,
      };
    } else {
      snapshot = { ...snapshot, live: readLive() };
    }
    synchronizeDetails();
    publish(snapshot);
  }

  /** Restarts the same latest key after RegionBoundary has entered a fresh Details retry generation. */
  function retryDetails(): void { loadDetails(); }

  /** Makes the next real Details request fail through the backend's fail=1 path, then allows Retry to recover. */
  function injectDetailsFailure(): void {
    if (!snapshot.detailsRegion || !detailsKey) return;
    failNextDetails = true;
    snapshot.detailsRegion.retry();
    loadDetails();
  }

  /** Throws from the actual Inspector render path on the next publication. */
  function injectRenderFailure(): void {
    if (!snapshot.region) return;
    publish({ ...snapshot, renderError: new Error("Inspector render failure") });
  }

  /** Clears only the injected render occurrence after the whole-inspector region starts a fresh generation. */
  function clearRenderFailure(): void { publish({ ...snapshot, renderError: null }); }

  /** Supplies the live Details target to dev trigger guards without retaining an old generation. */
  function detailsTarget(): FailureTarget { return snapshot.detailsRegion?.target ?? snapshot.region?.target ?? owner(); }

  /** Supplies the current whole-inspector target to render injection and fallback guards. */
  function inspectorTarget(): FailureTarget { return snapshot.region?.target ?? owner(); }

  if (dev) {
    removeTriggers.push(
      registerDevTrigger({ id: "details-fail", label: "Inspector Details request fails", target: detailsTarget, run: injectDetailsFailure }),
      registerDevTrigger({ id: "inspector-render", label: "Inspector render fails", target: inspectorTarget, run: injectRenderFailure }),
    );
  }
  const unsubscribeSelection = selection.subscribe(synchronize);
  synchronize();

  /** Reads one immutable Inspector projection for React and failure boundaries. */
  function getSnapshot(): InspectorSnapshot { return snapshot; }

  /** Registers a view without granting request or region ownership. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Removes only this Inspector reader. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }

  /** Cancels selection subscription, requests, regions and dev registrations with the board lifetime. */
  function dispose(): void {
    unsubscribeSelection();
    snapshot.region?.dispose();
    snapshot.detailsRegion?.dispose();
    for (const remove of removeTriggers) remove();
    listeners.clear();
  }

  return { getSnapshot, subscribe, retryDetails, clearRenderFailure, dispose };
}
export type InspectorStore = ReturnType<typeof createInspector>;
