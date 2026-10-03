// Owns screens, preview lifetimes and mode; selection, Layers and Inspector stores own inspection state while viewport owns motion.
import type { AgentMessage, HostMessage, Mode } from "../../../shared/protocol";
import type { ElementDetailsQuery } from "../api/elements";
import { fetchScreens } from "../api/screens";
import { runAttempt } from "../core/attempt";
import { registerDevTrigger } from "../core/dev-registry";
import { guard } from "../core/guard";
import { scopedFrame, scopedTimeout } from "../core/schedule";
import type { FailureRegion } from "./failure-region";
import { createPreview, type PreviewStore } from "./preview";
import { createViewport } from "./viewport";
import { createSelection } from "./selection";
import { createInspector } from "./inspector";
import { createLayers } from "./layers";

export interface BoardSnapshot { readonly loading: boolean; readonly previews: readonly PreviewStore[]; readonly mode: Mode; readonly renderError: Error | null }

/** Creates the product board with one discovery listener and abortable requests per board retry generation. */
export function createBoard(region: FailureRegion, dev: boolean) {
  let snapshot: BoardSnapshot = { loading: true, previews: [], mode: "select", renderError: null };
  let generation = region.getSnapshot().generation;
  let failing = false;
  let dragging = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const selection = createSelection(boardTarget, sendInspection);
  const layers = createLayers(selection, boardTarget, sendInspection, dev);
  const inspector = createInspector(selection, boardTarget, dev, elementQuery());
  const viewport = createViewport(boardTarget, clearHover);
  const removeTriggers: (() => void)[] = [];

  /** Supplies current ownership only for newly entered board work. */
  function boardTarget() { return region.target; }
  /** Reads optional host verification controls for Details only, leaving the screens request independently owned. */
  function elementQuery(): ElementDetailsQuery {
    const parameters = new URLSearchParams(window.location.search);
    const latencyValue = Number(parameters.get("latency"));
    const latency = parameters.has("latency") && Number.isFinite(latencyValue) && latencyValue >= 0 ? latencyValue : undefined;
    const fail = parameters.has("fail") && Number(parameters.get("fail")) > 0;
    return { latency, fail };
  }
  /** Publishes a complete shared snapshot rather than letting React own product state. */
  function update(next: BoardSnapshot): void { snapshot = next; for (const listener of listeners) listener(); }
  /** Returns the current board-generation product snapshot. */
  function getSnapshot(): BoardSnapshot { return snapshot; }
  /** Registers a view without granting it mutation access. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Detaches this board reader. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }
  /** Reads the mode for initial connection bootstraps as well as live mode commands. */
  function mode(): Mode { return snapshot.mode; }
  /** Sends a private command under the preview's own failure region. */
  function send(preview: PreviewStore, message: Parameters<PreviewStore["send"]>[0]): void { guard(preview.region.target, preview.send)(message); }
  /** Sends tracked sets/traversal only to the ready screen owner, never to a URL-sharing sibling. */
  function sendInspection(screenId: string, message: HostMessage): void {
    const preview = snapshot.previews.find(item => item.screen.id === screenId);
    if (preview?.getSnapshot().phase === "ready") send(preview, message);
  }
  /** Clears both host hover and all ready agents' dedupe caches when host motion starts. */
  function clearHover(): void {
    selection.clearHover();
    for (const preview of snapshot.previews) if (preview.getSnapshot().phase === "ready") send(preview, { type: "clear-hover" });
  }
  /** Drops only references owned by the replaced/failed document before new-instance traffic arrives. */
  function replaced(screenId: string): void {
    selection.forget(screenId);
    layers.forget(screenId);
  }
  /** Starts deferred active-preview tree loading only after the authenticated agent is ready. */
  function ready(screenId: string): void { layers.ready(screenId); }
  /** Changes mode once in the board store, then tells each isolated agent to change its own overlay. */
  function setMode(next: Mode): void {
    if (snapshot.mode === next) return;
    clearHover();
    selection.cancelNavigation();
    update({ ...snapshot, mode: next });
    for (const preview of snapshot.previews) send(preview, { type: "mode", mode: next });
  }
  /** Applies selection keys only in Select while preserving native Interact/editable letter behaviour. */
  function shortcut(key: string, editable: boolean, modified: boolean, shift: boolean): boolean {
    if (key === "Escape") { selection.clear(); return true; }
    if (snapshot.mode === "select" && !modified && (key === "Enter" || key === "Tab")) {
      selection.navigate(key === "Enter" ? shift ? "parent" : "child" : shift ? "previous" : "next");
      return true;
    }
    if (editable || modified) return false;
    if (key.toLowerCase() === "v") { setMode("select"); return true; }
    if (key.toLowerCase() === "i") { setMode("interact"); return true; }
    return false;
  }
  /** Converts iframe-local zoom coordinates using only the host's iframe box and painted scale. */
  function receive(screenId: string, message: AgentMessage): void {
    if (message.type === "hover") {
      if (snapshot.mode !== "select" || dragging) return;
      selection.hover(screenId, message.target);
    } else if (message.type === "select") {
      if (snapshot.mode === "select") selection.select(screenId, message.target, message.shiftKey);
    } else if (message.type === "geometry") {
      selection.receiveGeometry(screenId, message.revision, message.targets);
    } else if (message.type === "navigate-result") {
      selection.navigationResult(screenId, message.requestId, message.target);
    } else if (message.type === "reconcile") {
      selection.reconcile(screenId, message.targets, message.goneElementIds);
    } else if (message.type === "tree-children-result" || message.type === "tree-ancestors-result") {
      layers.receive(screenId, message);
    } else if (message.type === "key") {
      shortcut(message.key, message.editable, message.ctrlKey || message.metaKey || message.altKey, message.shiftKey);
    } else if (message.type === "zoom") {
      const frame = snapshot.previews.find(preview => preview.screen.id === screenId)?.getFrame();
      const board = document.querySelector<HTMLElement>('[data-testid="board"]');
      if (!frame || !board) return;
      const frameRect = frame.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const scale = viewport.getSnapshot().zoom;
      const delta = message.deltaY * (message.deltaMode === 1 ? 16 : message.deltaMode === 2 ? 800 : 1);
      viewport.zoomAt(frameRect.left + message.x * scale - boardRect.left, frameRect.top + message.y * scale - boardRect.top, delta);
    }
  }
  /** Dispatches discovery from one window listener, while each preview authenticates source and origin itself. */
  function hello(event: MessageEvent<unknown>): void {
    for (const preview of snapshot.previews) preview.discover(event);
  }
  /** Handles host-focused shortcuts with the same state owner as iframe-forwarded keys. */
  function key(event: KeyboardEvent): void {
    const active = document.activeElement;
    const editable = !!active && (active.matches("input,textarea,select") || (active instanceof HTMLElement && active.isContentEditable));
    const handled = shortcut(event.key, editable, event.ctrlKey || event.metaKey || event.altKey, event.shiftKey);
    if (handled && snapshot.mode === "select") event.preventDefault();
  }
  /** Ignores a trailing hover message during an empty-board drag. */
  function setDragging(value: boolean): void { dragging = value; if (value) clearHover(); }
  /** Builds all screens as independent preview owners even when their URLs are identical. */
  function load(): void {
    const failureMode = failing;
    failing = false;
    /** Fetches screens using the child attempt's abort signal. */
    function request(signal: AbortSignal) { return fetchScreens(signal, failureMode); }
    /** Creates preview owners only for this still-live validated response. */
    function apply(screens: Awaited<ReturnType<typeof fetchScreens>>): void {
      const previews = screens.map(makePreview);
      update({ ...snapshot, loading: false, previews });
    }
    /** Binds each screen to this exact board generation and its host-owned intent actions. */
    function makePreview(screen: Awaited<ReturnType<typeof fetchScreens>>[number]): PreviewStore {
      return createPreview(screen, region.target.ctx.scope, { mode, receive, replaced, ready });
    }
    runAttempt(region.target, request, apply);
  }
  /** Removes all old previews before a retry fetch, so late agent traffic cannot affect the replacement board. */
  function regionChanged(): void {
    const state = region.getSnapshot();
    if (state.generation === generation) return;
    generation = state.generation;
    for (const preview of snapshot.previews) preview.dispose();
    dragging = false;
    viewport.reset();
    selection.reset();
    update({ ...snapshot, previews: [], loading: true, renderError: null });
    guard(region.target, load)();
  }
  const unsubscribeRegion = region.subscribe(regionChanged);
  /** Resolves the current board generation for native global entry points without retaining dead ownership. */
  function nativeHello(event: MessageEvent<unknown>): void { if (!disposed) guard(region.target, hello)(event); }
  /** Resolves the current generation for host keyboard entry points. */
  function nativeKey(event: KeyboardEvent): void { if (!disposed) guard(region.target, key)(event); }
  /** Clears hover when the pointer leaves the browser rather than entering another preview. */
  function windowLeave(event: MouseEvent): void { if (event.relatedTarget === null) guard(region.target, clearHover)(); }
  window.addEventListener("message", nativeHello);
  window.addEventListener("keydown", nativeKey);
  window.addEventListener("mouseout", windowLeave);

  /** Retries the real screens endpoint with its built-in fail=1 response variations. */
  function screensFail(): void { failing = true; region.retry(); }
  /** Selects one screen's real handshake deadline, leaving the remaining previews intact. */
  function noConnect(): void { snapshot.previews[0]?.noConnect(); }
  /** Triggers a nonfatal preview badge/report through the same scoped page-event dispatcher. */
  function pageError(): void { snapshot.previews[0]?.injectPageError(); }
  /** Injects a real preview-owned outline drawing error on the next animation frame. */
  function outlineError(): void {
    const id = selection.getSnapshot().screenId ?? snapshot.previews[0]?.screen.id;
    const preview = snapshot.previews.find(item => item.screen.id === id);
    if (preview) selection.injectDrawFault(preview.screen.id, preview.getTarget());
  }
  /** Supplies the selected dev preview's region rather than reporting failures against the board. */
  function previewTarget() { return snapshot.previews[0]?.region.target ?? region.target; }
  /** Exercises a synchronous board entry point with the shared failure path. */
  function handlerError(): void { throw new Error("Board handler failure"); }
  /** Injects a real React board render error for the regional boundary. */
  function renderError(): void { update({ ...snapshot, renderError: new Error("Board render failure") }); }
  /** Exercises a board-owned guarded drawing callback. */
  function frameError(): void { scopedFrame(region.target, handlerError); }
  /** Exercises a board-owned guarded timer callback. */
  function timerError(): void { scopedTimeout(region.target, handlerError, 0); }
  if (dev) {
    removeTriggers.push(
      registerDevTrigger({ id: "screens-fail", label: "Screens request fails", target: boardTarget, run: screensFail }),
      registerDevTrigger({ id: "preview-no-connect", label: "First preview never connects (10s)", target: previewTarget, run: noConnect }),
      registerDevTrigger({ id: "page-error", label: "First preview page error", target: previewTarget, run: pageError }),
      registerDevTrigger({ id: "outline-draw", label: "Preview outline drawing fails", target: boardTarget, run: outlineError }),
      registerDevTrigger({ id: "board-handler", label: "Board handler fails", target: boardTarget, run: handlerError }),
      registerDevTrigger({ id: "render", label: "Board render fails", target: boardTarget, run: renderError }),
      registerDevTrigger({ id: "frame", label: "Board drawing fails", target: boardTarget, run: frameError }),
      registerDevTrigger({ id: "timer", label: "Board timer fails", target: boardTarget, run: timerError }),
    );
  }
  /** Stops listeners, queued motion and all screen owners when this host document is removed. */
  function dispose(): void {
    disposed = true;
    window.removeEventListener("message", nativeHello);
    window.removeEventListener("keydown", nativeKey);
    window.removeEventListener("mouseout", windowLeave);
    unsubscribeRegion();
    for (const remove of removeTriggers) remove();
    for (const preview of snapshot.previews) preview.dispose();
    viewport.dispose();
    inspector.dispose();
    layers.dispose();
    selection.dispose();
    listeners.clear();
  }
  guard(region.target, load)();
  return { region, viewport, selection, layers, inspector, getSnapshot, subscribe, setMode, clearHover, setDragging, dispose };
}
export type BoardStore = ReturnType<typeof createBoard>;
