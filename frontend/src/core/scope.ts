// Owns cancellation lifetimes and parent-child abort propagation; it does not publish values or decide failures.
export interface Scope {
  readonly signal: AbortSignal;
  readonly alive: boolean;
  dispose(): void;
}

/** Creates a lifetime whose disposal aborts its work and every child without resurrecting stale callbacks. */
export function createScope(parent?: Scope): Scope {
  const controller = new AbortController();
  let alive = true;
  /** Cancels this lifetime before firing abort listeners so observers already see it as dead. */
  function dispose(): void {
    if (!alive) return;
    alive = false;
    parent?.signal.removeEventListener("abort", dispose);
    controller.abort();
  }
  const scope: Scope = {
    signal: controller.signal,
    /** Exposes cancellation without requiring callers to own the AbortController. */
    get alive() { return alive; },
    dispose,
  };
  if (parent) {
    if (!parent.alive) dispose();
    else parent.signal.addEventListener("abort", dispose, { once: true });
  }
  return scope;
}
