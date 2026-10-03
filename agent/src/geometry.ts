// Measures only host-tracked identities once per animation frame, including overflow clips and Live inspector values; no selection state or whole-DOM polling is owned here.
import type { AgentMessage, Geometry, LiveData, Rect } from "../../shared/protocol";
import type { Identity } from "./identity";
import { native } from "./native";

/** Serializes the native element box, leaving host pan/zoom and constant-width borders to the host. */
function box(element: Element): Rect {
  const rect = native.rect.call(element);
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** Intersects a tracked box with scrollport padding boxes and the preview, independently on each overflow axis. */
function clipped(element: Element, rect: Rect): Rect | null {
  let left = Math.max(0, rect.x);
  let top = Math.max(0, rect.y);
  let right = Math.min(window.innerWidth, rect.x + rect.width);
  let bottom = Math.min(window.innerHeight, rect.y + rect.height);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.scrollingElement) continue;
    const style = native.getComputedStyle(parent);
    const x = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX);
    const y = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);
    if (!x && !y) continue;
    const boundary = native.rect.call(parent);
    const sx = parent instanceof HTMLElement && parent.offsetWidth ? boundary.width / parent.offsetWidth : 1;
    const sy = parent instanceof HTMLElement && parent.offsetHeight ? boundary.height / parent.offsetHeight : 1;
    if (x) {
      left = Math.max(left, boundary.left + parent.clientLeft * sx);
      right = Math.min(right, boundary.left + (parent.clientLeft + parent.clientWidth) * sx);
    }
    if (y) {
      top = Math.max(top, boundary.top + parent.clientTop * sy);
      bottom = Math.min(bottom, boundary.top + (parent.clientTop + parent.clientHeight) * sy);
    }
  }
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/** Reads bounded text/attributes, document position and computed typography for one connected tracked element. */
function live(element: Element, rect: Rect): LiveData {
  const style = native.getComputedStyle(element);
  const classes = (native.getAttribute.call(element, "class") ?? "").trim().replace(/\s+/g, " ");
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    dataKey: native.getAttribute.call(element, "data-key"),
    tag: element.tagName.toLowerCase(),
    id: native.getAttribute.call(element, "id") ?? "",
    classes,
    pageX: rect.x + window.scrollX,
    pageY: rect.y + window.scrollY,
    text,
    textColor: style.color,
    backgroundColor: style.backgroundColor,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
  };
}

/** Maintains a cancellable tracked-only poller; old revisions cannot publish into a newly bootstrapped connection. */
export function createGeometry(identity: Identity, send: (message: AgentMessage) => void, failure: (error: unknown) => void) {
  let revision = 0;
  let tracked: readonly string[] = [];
  let frameId: number | null = null;
  let previous = "";

  /** Measures the current uniquely proven binding without substituting an ambiguous sibling. */
  function measure(elementId: string): Geometry {
    const element = identity.lookup(elementId);
    if (!element) return { elementId, name: "", box: null, clip: null, live: null };
    const rect = box(element);
    return { elementId, name: identity.describe(element)!.name, box: rect, clip: clipped(element, rect), live: live(element, rect) };
  }
  /** Contains rAF exceptions inside the agent and emits only changed geometry for the latest exact tracked set. */
  function frame(): void {
    frameId = null;
    try {
      const targets = tracked.map(measure);
      const serialized = JSON.stringify(targets);
      if (serialized !== previous) {
        previous = serialized;
        send({ type: "geometry", revision, targets });
      }
      if (tracked.length) frameId = native.frame(frame);
    } catch (error) { failure(error); }
  }
  /** Replaces rather than appends tracking, cancelling any queued old-revision measurement. */
  function track(nextRevision: number, elementIds: readonly string[]): void {
    if (nextRevision <= revision) return;
    if (frameId !== null) native.cancelFrame(frameId);
    frameId = null;
    revision = nextRevision;
    tracked = elementIds;
    previous = "";
    if (tracked.length) frameId = native.frame(frame);
  }
  /** Stops old-port geometry before a replacement bootstrap can receive it. */
  function reset(): void {
    if (frameId !== null) native.cancelFrame(frameId);
    frameId = null;
    revision = 0;
    tracked = [];
    previous = "";
  }
  return { track, reset };
}
