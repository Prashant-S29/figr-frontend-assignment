// Validates private inspection, reconciliation, geometry, lazy/live tree and search traffic; DOM references and host-owned selection never cross here.
export type Mode = "select" | "interact";
export interface Target { elementId: string; name: string }
export interface Rect { x: number; y: number; width: number; height: number }
export interface LiveData {
  dataKey: string | null;
  tag: string;
  id: string;
  classes: string;
  pageX: number;
  pageY: number;
  text: string;
  textColor: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}
export interface Geometry extends Target { box: Rect | null; clip: Rect | null; live: LiveData | null }
export interface TreeNode extends Target { dataKey: string | null; hasChildren: boolean }
export interface TreeLevel { parentElementId: string | null; children: TreeNode[] }
export type Direction = "child" | "parent" | "next" | "previous";
export interface Hello { type: "hello"; instanceId: string }
export interface Connect { type: "connect"; instanceId: string; mode: Mode }
export type HostMessage =
  | { type: "mode"; mode: Mode }
  | { type: "ping"; requestId: number }
  | { type: "clear-hover" }
  | { type: "track"; revision: number; elementIds: string[] }
  | { type: "navigate"; requestId: number; elementId: string; direction: Direction }
  | { type: "tree-children"; requestId: number; parentElementId: string | null }
  | { type: "tree-ancestors"; requestId: number; elementId: string }
  | { type: "scroll-element"; elementId: string }
  | { type: "tree-watch"; parentElementIds: (string | null)[] }
  | { type: "tree-search"; requestId: number; query: string };
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
  | { type: "navigate-result"; requestId: number; target: Target | null }
  | { type: "tree-children-result"; requestId: number; parentElementId: string | null; children: TreeNode[] }
  | { type: "tree-ancestors-result"; requestId: number; path: TreeNode[] }
  | { type: "reconcile"; targets: Target[]; goneElementIds: string[] }
  | { type: "tree-update"; levels: TreeLevel[] }
  | { type: "tree-search-result"; requestId: number; paths: TreeNode[][] };

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

/** Validates one lazily exposed tree node and its optional reporting key. */
function treeNode(value: unknown): value is TreeNode {
  return record(value) && target(value) && (value.dataKey === null || typeof value.dataKey === "string") && typeof value.hasChildren === "boolean";
}

/** Validates a complete unique child level rather than permitting partial append updates. */
function treeLevel(value: unknown): value is TreeLevel {
  return record(value) && (value.parentElementId === null || elementId(value.parentElementId))
    && Array.isArray(value.children) && value.children.every(treeNode)
    && new Set((value.children as TreeNode[]).map(item => item.elementId)).size === value.children.length;
}

/** Validates one nonempty, cycle-free body-relative search path. */
function treePath(value: unknown): value is TreeNode[] {
  return Array.isArray(value) && value.length > 0 && value.every(treeNode)
    && new Set((value as TreeNode[]).map(item => item.elementId)).size === value.length;
}

/** Allows only nonnegative finite dimensions; off-viewport element positions may be negative. */
function rect(value: unknown): value is Rect {
  return record(value) && finite(value.x) && finite(value.y) && finite(value.width) && value.width >= 0 && finite(value.height) && value.height >= 0;
}

/** Validates bounded page-owned inspector values before host state can render or aggregate them. */
function live(value: unknown): value is LiveData {
  return record(value) && (value.dataKey === null || typeof value.dataKey === "string")
    && typeof value.tag === "string" && value.tag.length > 0
    && typeof value.id === "string" && typeof value.classes === "string"
    && finite(value.pageX) && finite(value.pageY)
    && typeof value.text === "string" && value.text.length <= 120
    && typeof value.textColor === "string" && typeof value.backgroundColor === "string"
    && typeof value.fontFamily === "string" && typeof value.fontSize === "string" && typeof value.fontWeight === "string";
}

/** Requires an element/preview intersection or explicit invisibility; far edges allow only subpixel arithmetic roundoff. */
function geometry(value: unknown): value is Geometry {
  if (!record(value) || !target(value)) return false;
  if (value.box === null) return value.clip === null && value.live === null;
  if (!rect(value.box) || !live(value.live)) return false;
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
    case "tree-children": return request(value.requestId) && (value.parentElementId === null || elementId(value.parentElementId));
    case "tree-ancestors": return request(value.requestId) && elementId(value.elementId);
    case "scroll-element": return elementId(value.elementId);
    case "tree-watch": return Array.isArray(value.parentElementIds) && value.parentElementIds.every(id => id === null || elementId(id))
      && new Set(value.parentElementIds).size === value.parentElementIds.length;
    case "tree-search": return request(value.requestId) && typeof value.query === "string";
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
    case "tree-children-result": return request(value.requestId) && (value.parentElementId === null || elementId(value.parentElementId))
      && Array.isArray(value.children) && value.children.every(treeNode)
      && new Set((value.children as TreeNode[]).map(item => item.elementId)).size === value.children.length;
    case "tree-ancestors-result": return request(value.requestId) && Array.isArray(value.path) && value.path.every(treeNode)
      && new Set((value.path as TreeNode[]).map(item => item.elementId)).size === value.path.length;
    case "tree-update": return Array.isArray(value.levels) && value.levels.every(treeLevel)
      && new Set((value.levels as TreeLevel[]).map(level => level.parentElementId)).size === value.levels.length;
    case "tree-search-result": return request(value.requestId) && Array.isArray(value.paths) && value.paths.every(treePath)
      && new Set((value.paths as TreeNode[][]).map(path => path[path.length - 1].elementId)).size === value.paths.length;
    case "reconcile": {
      if (!Array.isArray(value.targets) || !value.targets.every(item => target(item) && item !== null) || !Array.isArray(value.goneElementIds) || !value.goneElementIds.every(elementId)) return false;
      const targetIds = (value.targets as Target[]).map(item => item.elementId);
      return new Set(targetIds).size === targetIds.length && new Set(value.goneElementIds).size === value.goneElementIds.length
        && value.goneElementIds.every(id => !targetIds.includes(id));
    }
    case "hover": return target(value.target);
    case "select": return target(value.target) && typeof value.shiftKey === "boolean";
    case "agent-error":
    case "page-error": return typeof value.message === "string";
    case "zoom": return finite(value.x) && finite(value.y) && finite(value.deltaX) && finite(value.deltaY) && (value.deltaMode === 0 || value.deltaMode === 1 || value.deltaMode === 2);
    case "key": return typeof value.key === "string" && typeof value.code === "string" && typeof value.shiftKey === "boolean" && typeof value.ctrlKey === "boolean" && typeof value.metaKey === "boolean" && typeof value.altKey === "boolean" && typeof value.editable === "boolean" && typeof value.repeat === "boolean";
    default: return false;
  }
}
