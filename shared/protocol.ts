// Validates private inspection, tracked geometry, traversal and liveness traffic; DOM references and host-owned selection never cross here.
export type Mode = "select" | "interact";
export interface Target { elementId: string; name: string }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Geometry extends Target { box: Rect | null; clip: Rect | null }
export type Direction = "child" | "parent" | "next" | "previous";
export interface Hello { type: "hello"; instanceId: string }
export interface Connect { type: "connect"; instanceId: string; mode: Mode }
export type HostMessage =
  | { type: "mode"; mode: Mode }
  | { type: "ping"; requestId: number }
  | { type: "clear-hover" }
  | { type: "track"; revision: number; elementIds: string[] }
  | { type: "navigate"; requestId: number; elementId: string; direction: Direction };
export type AgentMessage =
  | { type: "ready"; instanceId: string }
  | { type: "pong"; requestId: number }
  | { type: "hover"; target: Target | null }
  | { type: "select"; target: Target | null; shiftKey: boolean }
  | { type: "key"; key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; editable: boolean; repeat: boolean }
  | { type: "zoom"; x: number; y: number; deltaX: number; deltaY: number; deltaMode: number }
  | { type: "agent-error"; message: string }
  | { type: "page-error"; message: string }
  | { type: "geometry"; revision: number; targets: Geometry[] }
  | { type: "navigate-result"; requestId: number; target: Target | null };

/** Rejects non-object wire values before any field is accessed. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Limits modes to the two PRD-defined page interaction states. */
function mode(value: unknown): value is Mode {
  return value === "select" || value === "interact";
}

/** Checks a nonempty agent-generated document token. */
function instance(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}

/** Ensures coordinates and wheel deltas cannot carry NaN or infinity. */
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Checks correlation ids without accepting fractional or negative requests. */
function request(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Validates a serialized target without trusting page-provided names as markup. */
function target(value: unknown): value is Target | null {
  if (value === null) return true;
  if (!record(value) || typeof value.elementId !== "string" || typeof value.name !== "string") return false;
  return elementId(value.elementId);
}

/** Checks an agent-minted identity without accepting document nodes or sibling indices. */
function elementId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const separator = value.lastIndexOf(":");
  return instance(value.slice(0, separator)) && /^[1-9]\d*$/.test(value.slice(separator + 1));
}

/** Allows only nonnegative finite dimensions; off-viewport element positions may be negative. */
function rect(value: unknown): value is Rect {
  return record(value) && finite(value.x) && finite(value.y) && finite(value.width) && value.width >= 0 && finite(value.height) && value.height >= 0;
}

/** Requires an element/preview intersection or explicit invisibility; far edges allow only subpixel arithmetic roundoff. */
function geometry(value: unknown): value is Geometry {
  if (!record(value) || !target(value)) return false;
  if (value.box === null) return value.clip === null;
  if (!rect(value.box)) return false;
  if (value.clip === null) return true;
  if (!rect(value.clip)) return false;
  const box = value.box;
  const clip = value.clip;
  return clip.width > 0 && clip.height > 0 && clip.x >= Math.max(0, box.x) && clip.y >= Math.max(0, box.y)
    && clip.x + clip.width <= Math.min(1280, box.x + box.width) + 1e-6
    && clip.y + clip.height <= Math.min(800, box.y + box.height) + 1e-6;
}

/** Validates the only agent message accepted on the public window channel. */
export function isHello(value: unknown): value is Hello {
  return record(value) && value.type === "hello" && instance(value.instanceId);
}

/** Validates host bootstrap data; the transferred port is checked by the receiver separately. */
export function isConnect(value: unknown): value is Connect {
  return record(value) && value.type === "connect" && instance(value.instanceId) && mode(value.mode);
}

/** Validates overlay controls, exact tracked sets and correlated element traversal. */
export function isHostMessage(value: unknown): value is HostMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case "mode": return mode(value.mode);
    case "ping": return request(value.requestId);
    case "clear-hover": return true;
    case "track": return request(value.revision) && Array.isArray(value.elementIds) && value.elementIds.every(elementId) && new Set(value.elementIds).size === value.elementIds.length;
    case "navigate": return request(value.requestId) && elementId(value.elementId) && typeof value.direction === "string" && ["child", "parent", "next", "previous"].includes(value.direction);
    default: return false;
  }
}

/** Validates every private-port agent intent before the host can use it. */
export function isAgentMessage(value: unknown): value is AgentMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case "ready": return instance(value.instanceId);
    case "pong": return request(value.requestId);
    case "geometry": return request(value.revision) && Array.isArray(value.targets) && value.targets.every(geometry) && new Set((value.targets as Geometry[]).map(item => item.elementId)).size === value.targets.length;
    case "navigate-result": return request(value.requestId) && target(value.target);
    case "hover": return target(value.target);
    case "select": return target(value.target) && typeof value.shiftKey === "boolean";
    case "agent-error":
    case "page-error": return typeof value.message === "string";
    case "zoom": return finite(value.x) && finite(value.y) && finite(value.deltaX) && finite(value.deltaY) && (value.deltaMode === 0 || value.deltaMode === 1 || value.deltaMode === 2);
    case "key": return typeof value.key === "string" && typeof value.code === "string" && typeof value.shiftKey === "boolean" && typeof value.ctrlKey === "boolean" && typeof value.metaKey === "boolean" && typeof value.altKey === "boolean" && typeof value.editable === "boolean" && typeof value.repeat === "boolean";
    default: return false;
  }
}
