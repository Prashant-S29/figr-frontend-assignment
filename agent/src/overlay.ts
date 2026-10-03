// Owns Select-mode pointer isolation, hit-testing, stationary-pointer refresh and wheel emulation; host selection and identity reconciliation are not owned here.
import type { AgentMessage, Mode } from "../../shared/protocol";
import type { Identity } from "./identity";
import { native } from "./native";

/** Installs an isolated overlay and guarded input entry points without changing page-owned nodes. */
export function createOverlay(identity: Identity, send: (message: AgentMessage) => void, protect: (handler: EventListener) => EventListener) {
  const host = native.createElement("figr-agent");
  const shadow = native.attachShadow.call(host, { mode: "closed" });
  const surface = native.createElement("div");
  let mode: Mode = "select";
  let lastHover: string | null = null;
  let lastPoint: { x: number; y: number } | null = null;

  native.setStyle.call(host.style, "all", "initial", "important");
  native.setStyle.call(host.style, "position", "fixed", "important");
  native.setStyle.call(host.style, "inset", "0", "important");
  native.setStyle.call(host.style, "z-index", "2147483647", "important");
  native.setStyle.call(host.style, "pointer-events", "none", "important");
  surface.tabIndex = -1;
  surface.style.cssText = "position:fixed;inset:0;pointer-events:auto;cursor:default;touch-action:none;background:transparent;outline:none;";
  native.appendChild.call(shadow, surface);
  native.appendChild.call(document.documentElement, host);

  /** Finds the topmost page element beneath the agent, excluding document background. */
  function hit(x: number, y: number): Element | null {
    return native.elementsFromPoint(x, y).find(element => element !== host && element !== document.documentElement && element !== document.body) ?? null;
  }

  /** Emits only changed hover intents, leaving single-board-hover ownership to the host. */
  function hover(element: Element | null): void {
    const target = identity.describe(element);
    const id = target?.elementId ?? null;
    if (id === lastHover) return;
    lastHover = id;
    send({ type: "hover", target });
  }

  /** Cancels the browser action and stops page listeners before their capture handlers run. */
  function swallow(event: Event): void {
    native.preventDefault.call(event);
    native.stopImmediate.call(event);
  }

  /** Captures overlay pointer input while never interfering with Interact-mode page events. */
  function pointer(event: Event): void {
    if (mode !== "select" || !native.eventPath.call(event).includes(host)) return;
    swallow(event);
    const input = event as MouseEvent;
    // Pointer default cancellation blocks iframe focus; focus only our neutral surface, never a page control.
    if (event.type === "pointerdown" && input.button === 0) native.focusElement.call(surface, { preventScroll: true });
    if (event.type === "pointermove" || event.type === "pointerover") {
      lastPoint = { x: input.clientX, y: input.clientY };
      hover(hit(input.clientX, input.clientY));
    }
    if (event.type === "click" && input.button === 0) send({ type: "select", target: identity.describe(hit(input.clientX, input.clientY)), shiftKey: input.shiftKey });
  }

  /** Clears hover when the pointer exits the preview without synthesizing page events. */
  function leave(): void {
    lastPoint = null;
    hover(null);
  }

  /** Consumes a wheel axis locally and returns only the unconsumed distance for outward chaining. */
  function scrollAxis(element: Element, axis: "x" | "y", delta: number, overflow: string): number {
    if (!delta || !/^(auto|scroll|overlay)$/.test(overflow)) return delta;
    const before = axis === "x" ? element.scrollLeft : element.scrollTop;
    native.scrollElement.call(element, { left: axis === "x" ? delta : 0, top: axis === "y" ? delta : 0, behavior: "instant" });
    const after = axis === "x" ? element.scrollLeft : element.scrollTop;
    return delta - (after - before);
  }

  /** Emulates overlay wheel scrolling from the hit element through nested containers to the page. */
  function scrollPage(input: WheelEvent): void {
    let x = input.deltaX * (input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? window.innerWidth : 1);
    let y = input.deltaY * (input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? window.innerHeight : 1);
    for (let element = hit(input.clientX, input.clientY); element && element !== document.scrollingElement; element = element.parentElement) {
      const style = native.getComputedStyle(element);
      x = scrollAxis(element, "x", x, style.overflowX);
      y = scrollAxis(element, "y", y, style.overflowY);
      if (!x && !y) break;
    }
    if (x || y) native.scrollWindow({ left: x, top: y, behavior: "instant" });
    hover(hit(input.clientX, input.clientY));
  }

  /** Forwards zoom in both modes; ordinary Interact wheel input remains entirely native. */
  function wheel(event: Event): void {
    const input = event as WheelEvent;
    if (input.ctrlKey || input.metaKey) {
      swallow(input);
      hover(null);
      send({ type: "zoom", x: input.clientX, y: input.clientY, deltaX: input.deltaX, deltaY: input.deltaY, deltaMode: input.deltaMode });
    } else if (mode === "select") {
      swallow(input);
      lastPoint = { x: input.clientX, y: input.clientY };
      scrollPage(input);
    }
  }

  /** Forwards viewer shortcuts from iframe focus while preserving editable letter input and native Interact actions. */
  function key(event: Event): void {
    const input = event as KeyboardEvent;
    const active = document.activeElement;
    const editable = !!active && (native.matches.call(active, "input,textarea,select") || (active instanceof HTMLElement && active.isContentEditable));
    const letter = input.key.toLowerCase() === "v" || input.key.toLowerCase() === "i";
    const shortcut = ["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(input.key);
    if ((!letter && !shortcut) || (letter && (editable || input.ctrlKey || input.metaKey || input.altKey))) return;
    if (mode === "select" || letter) swallow(input);
    send({ type: "key", key: input.key, code: input.code, shiftKey: input.shiftKey, ctrlKey: input.ctrlKey, metaKey: input.metaKey, altKey: input.altKey, editable, repeat: input.repeat });
  }

  /** Re-hit-tests the last Select pointer after page mutations without synthesizing a page event. */
  function refreshHover(): void {
    if (mode === "select" && lastPoint) hover(hit(lastPoint.x, lastPoint.y));
  }

  /** Resets cached hover and pointer position after host movement until genuine preview input resumes. */
  function clearHover(): void { lastPoint = null; hover(null); }

  /** Switches only the agent overlay; the host retains all selection and product state. */
  function setMode(next: Mode): void {
    mode = next;
    lastPoint = null;
    native.setStyle.call(host.style, "display", next === "select" ? "block" : "none", "important");
    hover(null);
  }

  const capture = { capture: true, passive: false };
  for (const type of ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "click", "dblclick", "contextmenu"]) {
    native.addListener.call(window, type, protect(pointer), capture);
  }
  native.addListener.call(surface, "pointerleave", protect(leave));
  native.addListener.call(window, "wheel", protect(wheel), capture);
  native.addListener.call(window, "keydown", protect(key), capture);
  return { setMode, clearHover, refreshHover };
}
