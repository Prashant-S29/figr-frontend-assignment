// Resolves public API paths for local or hosted builds; callers own cancellation, response validation and regional failures.

/** Parses the configured origin inside each guarded request, keeping misconfiguration on the normal failure path. */
export function apiUrl(path: string): string {
  return new URL(path, import.meta.env.VITE_API_ORIGIN || "http://localhost:4000").href;
}
