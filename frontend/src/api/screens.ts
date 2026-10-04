// Fetches and validates the board's untrusted screen list from the configured API; request lifetime and failures belong to the board store.
import { apiUrl } from "./url";

export interface Screen { readonly id: string; readonly name: string; readonly url: string }

/** Narrows an untrusted entry without allowing array validation to introduce implicit any values. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects malformed, duplicate or non-cross-origin entries before any iframe is created. */
function validate(value: unknown): readonly Screen[] {
  if (!Array.isArray(value)) throw new Error("Invalid screens response");
  const ids = new Set<string>();
  const screens: Screen[] = [];
  for (const entry of value as unknown[]) {
    if (!record(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || typeof entry.url !== "string") throw new Error("Invalid screen entry");
    if (ids.has(entry.id)) throw new Error("Duplicate screen id");
    const url = new URL(entry.url);
    if (!["http:", "https:"].includes(url.protocol) || url.origin === window.location.origin || url.username || url.password) throw new Error("Invalid preview URL");
    ids.add(entry.id);
    screens.push({ id: entry.id, name: entry.name, url: url.href });
  }
  return screens;
}

/** Loads either the ordinary list or an explicit dev failure, honouring cancellation even during body parsing. */
export async function fetchScreens(signal: AbortSignal, failing = false): Promise<readonly Screen[]> {
  const response = await fetch(apiUrl(`/screens${failing ? "?fail=1" : ""}`), { signal });
  if (!response.ok) throw new Error(`Couldn't load screens (${response.status})`);
  const body: unknown = await response.json();
  return validate(body);
}
