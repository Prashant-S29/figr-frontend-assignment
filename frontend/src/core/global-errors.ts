// Routes global host errors to their original scope, falling back to the board; iframe page errors belong to the agent.
import { fail, failureOwner, type FailureTarget } from "./fail";

/** Feeds a global occurrence through the same dedupe path used by guards and region boundaries. */
export function routeGlobalError(fallback: FailureTarget, error: unknown): void {
  const target = failureOwner(error) ?? fallback;
  fail(target.region, error, target.ctx);
}

/** Installs host-global handlers using the current board scope rather than a stale retry generation. */
export function installGlobalErrors(getFallback: () => FailureTarget): () => void {
  /** Attributes runtime errors before suppressing the browser's duplicate default presentation. */
  function error(event: ErrorEvent): void {
    routeGlobalError(getFallback(), event.error ?? new Error(event.message));
    event.preventDefault();
  }
  /** Contains unhandled rejections without treating a known cancelled operation as a new board failure. */
  function rejection(event: PromiseRejectionEvent): void {
    routeGlobalError(getFallback(), event.reason);
    event.preventDefault();
  }
  window.addEventListener("error", error);
  window.addEventListener("unhandledrejection", rejection);
  /** Removes global hooks when the owning host lifetime ends. */
  return function remove(): void {
    window.removeEventListener("error", error);
    window.removeEventListener("unhandledrejection", rejection);
  };
}
