// Exposes diagnostic console output in development or ?dev; it does not decide or report failures.
/** Emits diagnostics only when the host explicitly runs with development visibility. */
export function devLog(label: string, value: unknown): void {
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has("dev")) {
    console.log(label, value);
  }
}
