// Defines and validates private inspection/liveness and page-error traffic; DOM references, geometry and tree state never cross here.
export type Mode = "select" | "interact";
export interface Target { elementId: string; name: string }
export interface Hello { type: "hello"; instanceId: string }
export interface Connect { type: "connect"; instanceId: string; mode: Mode }
export type HostMessage = { type: "mode"; mode: Mode } | { type: "ping"; requestId: number } | { type: "clear-hover" };
export type AgentMessage =
  | { type: "ready"; instanceId: string }
  | { type: "pong"; requestId: number }
  | { type: "hover"; target: Target | null }
  | { type: "select"; target: Target | null; shiftKey: boolean }
  | { type: "key"; key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; editable: boolean; repeat: boolean }
  | { type: "zoom"; x: number; y: number; deltaX: number; deltaY: number; deltaMode: number }
  | { type: "agent-error"; message: string }
  | { type: "page-error"; message: string };

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
  const separator = value.elementId.lastIndexOf(":");
  return instance(value.elementId.slice(0, separator)) && /^[1-9]\d*$/.test(value.elementId.slice(separator + 1));
}

/** Validates the only agent message accepted on the public window channel. */
export function isHello(value: unknown): value is Hello {
  return record(value) && value.type === "hello" && instance(value.instanceId);
}

/** Validates host bootstrap data; the transferred port is checked by the receiver separately. */
export function isConnect(value: unknown): value is Connect {
  return record(value) && value.type === "connect" && instance(value.instanceId) && mode(value.mode);
}

/** Accepts only overlay mode, hover reset and correlated liveness commands. */
export function isHostMessage(value: unknown): value is HostMessage {
  if (!record(value)) return false;
  return (value.type === "mode" && mode(value.mode)) || (value.type === "ping" && request(value.requestId)) || value.type === "clear-hover";
}

/** Validates every private-port agent intent before the host can use it. */
export function isAgentMessage(value: unknown): value is AgentMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case "ready": return instance(value.instanceId);
    case "pong": return request(value.requestId);
    case "hover": return target(value.target);
    case "select": return target(value.target) && typeof value.shiftKey === "boolean";
    case "agent-error":
    case "page-error": return typeof value.message === "string";
    case "zoom": return finite(value.x) && finite(value.y) && finite(value.deltaX) && finite(value.deltaY) && (value.deltaMode === 0 || value.deltaMode === 1 || value.deltaMode === 2);
    case "key": return typeof value.key === "string" && typeof value.code === "string" && typeof value.shiftKey === "boolean" && typeof value.ctrlKey === "boolean" && typeof value.metaKey === "boolean" && typeof value.altKey === "boolean" && typeof value.editable === "boolean" && typeof value.repeat === "boolean";
    default: return false;
  }
}
