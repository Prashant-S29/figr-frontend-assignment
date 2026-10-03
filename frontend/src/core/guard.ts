// Guards scoped callback entry points, including returned promises; it never retries work or owns region state.
import { fail, type FailureTarget } from "./fail";

/** Wraps handlers, response callbacks, timers and rAF without running or reporting dead work. */
export function guard<Args extends unknown[]>(target: FailureTarget, work: (...args: Args) => unknown): (...args: Args) => void {
  /** Captures the invocation's owner before any synchronous or asynchronous error can escape. */
  return function guarded(...args: Args): void {
    if (!target.ctx.scope.alive) return;
    try {
      const result = work(...args);
      if (result && (typeof result === "object" || typeof result === "function") && typeof (result as { then?: unknown }).then === "function") {
        Promise.resolve(result).catch(rejected);
      }
    } catch (error) { rejected(error); }
  };
  /** Routes errors with their original scope, making cancellation and subsequent global catches silent. */
  function rejected(error: unknown): void { fail(target.region, error, target.ctx); }
}
