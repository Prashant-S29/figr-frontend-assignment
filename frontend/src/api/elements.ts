// Fetches and validates Details from the configured API; selection lifetime, retries and presentation belong to the inspector store.
import { apiUrl } from "./url";

export interface ElementDetails {
  readonly component: string;
  readonly description: string;
  readonly status: string;
  readonly owner: string;
}
export type ElementDetailsResult = { readonly kind: "found"; readonly details: ElementDetails } | { readonly kind: "not-found" };
export interface ElementDetailsQuery { readonly latency?: number; readonly fail?: boolean }

/** Rejects arrays, null and primitive bodies before any detail field is read. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Requires the complete fixed Details shape while keeping every backend string text-only. */
function validate(value: unknown): ElementDetails {
  if (!record(value) || typeof value.component !== "string" || typeof value.description !== "string"
    || typeof value.status !== "string" || typeof value.owner !== "string") throw new Error("Invalid element details response");
  return { component: value.component, description: value.description, status: value.status, owner: value.owner };
}

/** Loads one key with optional verification latency/failure controls and treats 404 as ordinary absence. */
export async function fetchElementDetails(key: string, signal: AbortSignal, query: ElementDetailsQuery = {}): Promise<ElementDetailsResult> {
  const search = new URLSearchParams();
  if (query.latency !== undefined) search.set("latency", String(query.latency));
  if (query.fail) search.set("fail", "1");
  const suffix = search.size ? `?${search}` : "";
  const response = await fetch(apiUrl(`/elements/${encodeURIComponent(key)}${suffix}`), { signal });
  return readElementDetails(response);
}

/** Reads a response through the same status, JSON and complete-shape boundary for network and dev fault bodies. */
export async function readElementDetails(response: Response): Promise<ElementDetailsResult> {
  if (response.status === 404) return { kind: "not-found" };
  if (!response.ok) throw new Error(`Couldn't load details (${response.status})`);
  const body: unknown = await response.json();
  return { kind: "found", details: validate(body) };
}
