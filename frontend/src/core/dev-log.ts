// Exposes explicitly enabled diagnostic console output; it does not detect failures or require a browser during unit tests.
let enabled = false;

/** Sets visibility once at host bootstrap from Vite dev mode or the ?dev query. */
export function enableDevLog(visible: boolean): void { enabled = visible; }

/** Emits diagnostics only while the host runs with development visibility. */
export function devLog(label: string, value: unknown): void {
  if (enabled) console.log(label, value);
}
