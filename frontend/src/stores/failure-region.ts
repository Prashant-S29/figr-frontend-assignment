// Owns one region's error snapshot and retry generations; reporting and error deduplication belong to fail().
import type { Failure, FailureTarget } from "../core/fail";
import type { Region, ReportContext } from "../core/report";
import { createScope, type Scope } from "../core/scope";

export interface RegionSnapshot { readonly failure: Failure | null; readonly generation: number }

/** Creates an isolated region owner; consumers read snapshots and request actions rather than mutating state. */
export function createFailureRegion(region: Region, context: Omit<ReportContext, "region">, parent?: Scope) {
  let scope = createScope(parent);
  let disposed = false;
  let snapshot: RegionSnapshot = { failure: null, generation: 0 };
  const listeners = new Set<() => void>();
  let target = makeTarget();

  /** Binds publication to this retry generation so old attempts can never update a replacement. */
  function makeTarget(): FailureTarget {
    const generationScope = scope;
    /** Publishes only the first visible error while this exact region generation is alive. */
    function publish(failure: Failure): void {
      if (disposed || scope !== generationScope || !scope.alive || snapshot.failure) return;
      snapshot = { ...snapshot, failure };
      notify();
    }
    return { region, ctx: { ...context, scope, publish } };
  }

  /** Notifies external-store readers after a complete snapshot replacement. */
  function notify(): void { for (const listener of listeners) listener(); }

  /** Reads the stable error snapshot without exposing mutation actions through React. */
  function getSnapshot(): RegionSnapshot { return snapshot; }

  /** Registers a reader whose disposal never changes the region's failure state. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Removes only this view's subscription. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }

  /** Aborts previous work and starts a new retry generation; a disposed owner cannot be resurrected. */
  function retry(): void {
    if (disposed || (parent && !parent.alive)) return;
    scope.dispose();
    scope = createScope(parent);
    target = makeTarget();
    snapshot = { failure: null, generation: snapshot.generation + 1 };
    notify();
  }

  /** Makes all late work silent and drops readers when this specific region leaves the host. */
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scope.dispose();
    listeners.clear();
  }

  return {
    /** Exposes the current generation for newly entered work, never for already-running attempts. */
    get target() { return target; },
    getSnapshot, subscribe, retry, dispose,
  };
}

export type FailureRegion = ReturnType<typeof createFailureRegion>;
