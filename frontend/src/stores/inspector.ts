// Owns Inspector selection projection, Details request lifetime and inspector/details failure regions; the agent owns Live DOM reads and React only renders snapshots.
import type { LiveData } from "../../../shared/protocol";
import { fetchElementDetails, readElementDetails, type ElementDetails, type ElementDetailsQuery } from "../api/elements";
import { runAttempt } from "../core/attempt";
import { registerDevTrigger } from "../core/dev-registry";
import { scopedTimeout } from "../core/schedule";
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

type DetailsFault = "bad-json" | "bad-shape" | "response" | "late-response" | "late-error" | "gone-response" | "gone-error";

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
  let nextDetailsFault: DetailsFault | null = null;
  let renderRetryError: Error | null = null;
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
    failNextDetails = false;
    nextDetailsFault = null;
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
    const fault = nextDetailsFault;
    const deliveryTarget = owner();
    failNextDetails = false;
    nextDetailsFault = null;
    publish({ ...snapshot, details: { kind: "loading" } });
    /** Fetches the current key with URL verification controls and one-shot dev failure injection. */
    async function request(signal: AbortSignal): Promise<Awaited<ReturnType<typeof fetchElementDetails>>> {
      const result = await fetchElementDetails(key, signal, { latency: query.latency, fail: forcedFailure || query.fail });
      // A completed body may outlive abort; do not let its dev handoff clear or retry the newer selection.
      if (signal.aborted) return result;
      if (fault === "bad-json" || fault === "bad-shape") {
        return readElementDetails(new Response(fault === "bad-json" ? '{"component":' : '{"component":42}', { status: 200 }));
      }
      if (fault === "late-response" || fault === "late-error" || fault === "gone-response" || fault === "gone-error") {
        /** Models an already-arrived transport completion that cannot be aborted; only the attempt may publish it. */
        function delayed(resolve: (value: typeof result) => void, reject: (error: Error) => void): void {
          /** Settles transport data under the board lifetime, never publishing to the replaced Details region. */
          function deliver(): void {
            if (fault === "late-error" || fault === "gone-error") reject(new Error("Delayed Details error"));
            else resolve(result);
          }
          scopedTimeout(deliveryTarget, deliver, 800);
        }
        const pending = new Promise(delayed);
        if (snapshot.detailsRegion === region) {
          if (fault === "gone-response" || fault === "gone-error") selection.clear();
          else { region.retry(); loadDetails(); }
        }
        return pending;
      }
      return result;
    }
    /** Publishes only through this exact still-current region, including the real response-application fault path. */
    function apply(result: Awaited<ReturnType<typeof fetchElementDetails>>): void {
      if (fault === "response") throw new Error("Details response arrival failure");
      applyDetails(region, result);
    }
    runAttempt(region.target, request, apply);
  }

  /** Creates, removes or retains Details work according to the latest complete single-selection Live value. */
  function synchronizeDetails(): void {
    if (snapshot.count !== 1 || snapshot.region?.getSnapshot().failure) {
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
    const region = createFailureRegion("details", { screenId: snapshot.screenId, elementKey: value.dataKey }, snapshot.region!.target.ctx.scope);
    detailsToken = token;
    detailsKey = value.dataKey;
    snapshot = { ...snapshot, details: { kind: "loading" }, detailsRegion: region };
    loadDetails();
  }

  /** Cancels hidden Details work when the whole Inspector enters its fallback, rather than reporting invisible child failures. */
  function inspectorRegion(screenId: string): FailureRegion {
    const region = createFailureRegion("inspector", { screenId }, owner().ctx.scope);
    /** Removes child ownership only for this still-current failed panel generation. */
    function changed(): void {
      if (snapshot.region !== region || !region.getSnapshot().failure) return;
      disposeDetails();
      publish({ ...snapshot, details: { kind: "hidden" }, detailsRegion: null });
    }
    region.subscribe(changed);
    return region;
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
      nextDetailsFault = null;
      renderRetryError = null;
      const screenId = selected.screenId ?? selected.activeScreenId;
      const region = screenId ? inspectorRegion(screenId) : null;
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

  /** Re-enters the latest Details request with one deterministic parser, arrival or cancellation probe. */
  function injectDetailsFault(fault: DetailsFault): void {
    if (!snapshot.detailsRegion || !detailsKey) return;
    nextDetailsFault = fault;
    snapshot.detailsRegion.retry();
    loadDetails();
  }

  /** Arms a backend failure for the region's actual Retry button instead of immediately creating another occurrence. */
  function armRetryFailure(): void { if (snapshot.detailsRegion) failNextDetails = true; }

  /** Drives malformed JSON through the production response reader. */
  function badJson(): void { injectDetailsFault("bad-json"); }
  /** Drives a valid JSON body with missing/wrong fields through the production validator. */
  function badShape(): void { injectDetailsFault("bad-shape"); }
  /** Throws only after a real current Details response reaches its application callback. */
  function responseFailure(): void { injectDetailsFault("response"); }
  /** Delivers a response after its request generation has been replaced. */
  function lateResponse(): void { injectDetailsFault("late-response"); }
  /** Delivers an error after its request generation has been replaced. */
  function lateError(): void { injectDetailsFault("late-error"); }
  /** Clears selection before an unabortable response completion arrives. */
  function goneResponse(): void { injectDetailsFault("gone-response"); }
  /** Clears selection before an unabortable error completion arrives. */
  function goneError(): void { injectDetailsFault("gone-error"); }

  /** Throws from the actual Inspector render path on the next publication. */
  function injectRenderFailure(): void {
    if (!snapshot.region) return;
    publish({ ...snapshot, renderError: new Error("Inspector render failure") });
  }

  /** Reuses the same render Error on an explicitly armed live Retry to exercise generation-scoped dedupe. */
  function armRenderRetry(): void { if (snapshot.region) renderRetryError = snapshot.renderError ?? new Error("Inspector retry render failure"); }

  /** Clears only the injected render occurrence after the whole-inspector region starts a fresh generation. */
  function clearRenderFailure(): void {
    snapshot = { ...snapshot, renderError: renderRetryError };
    renderRetryError = null;
    synchronizeDetails();
    publish(snapshot);
  }

  /** Supplies the live Details target to dev trigger guards without retaining an old generation. */
  function detailsTarget(): FailureTarget { return snapshot.detailsRegion?.target ?? snapshot.region?.target ?? owner(); }

  /** Supplies the current whole-inspector target to render injection and fallback guards. */
  function inspectorTarget(): FailureTarget { return snapshot.region?.target ?? owner(); }

  if (dev) {
    removeTriggers.push(
      registerDevTrigger({ id: "details-fail", label: "Inspector Details request fails", target: detailsTarget, run: injectDetailsFailure }),
      registerDevTrigger({ id: "details-bad-json", label: "Details response has invalid JSON", target: detailsTarget, run: badJson }),
      registerDevTrigger({ id: "details-bad-shape", label: "Details response has wrong shape", target: detailsTarget, run: badShape }),
      registerDevTrigger({ id: "details-response", label: "Details response arrival fails", target: detailsTarget, run: responseFailure }),
      registerDevTrigger({ id: "details-retry-fail", label: "Next Details Retry fails once", target: detailsTarget, run: armRetryFailure }),
      registerDevTrigger({ id: "details-late-response", label: "Details response after replacement (silent)", target: detailsTarget, run: lateResponse }),
      registerDevTrigger({ id: "details-late-error", label: "Details error after replacement (silent)", target: detailsTarget, run: lateError }),
      registerDevTrigger({ id: "details-gone-response", label: "Clear selection before Details response (silent)", target: detailsTarget, run: goneResponse }),
      registerDevTrigger({ id: "details-gone-error", label: "Clear selection before Details error (silent)", target: detailsTarget, run: goneError }),
      registerDevTrigger({ id: "inspector-retry-fail", label: "Next Inspector Retry rethrows render error", target: inspectorTarget, run: armRenderRetry }),
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
