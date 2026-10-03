// Owns screens, preview lifetimes, mode and single-board hover; the viewport owns motion and later milestones own selection/tree/inspector.
import type { AgentMessage, Mode, Target } from "../../../shared/protocol";
import { fetchScreens } from "../api/screens";
import { runAttempt } from "../core/attempt";
import { registerDevTrigger } from "../core/dev-registry";
import { guard } from "../core/guard";
import { scopedFrame, scopedTimeout } from "../core/schedule";
import type { FailureRegion } from "./failure-region";
import { createPreview, type PreviewStore } from "./preview";
import { createViewport } from "./viewport";

export interface Hover { readonly screenId: string; readonly target: Target }
export interface BoardSnapshot { readonly loading: boolean; readonly previews: readonly PreviewStore[]; readonly mode: Mode; readonly hover: Hover | null; readonly renderError: Error | null }

/** Creates the product board with one discovery listener and abortable requests per board retry generation. */
export function createBoard(region: FailureRegion, dev: boolean) {
  let snapshot: BoardSnapshot = { loading: true, previews: [], mode: "select", hover: null, renderError: null };
  let generation = region.getSnapshot().generation;
  let failing = false;
  let dragging = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const viewport = createViewport(boardTarget, clearHover);
  const removeTriggers: (() => void)[] = [];

  /** Supplies current ownership only for newly entered board work. */
  function boardTarget() { return region.target; }
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
  /** Clears both host hover and all ready agents' dedupe caches when host motion starts. */
  function clearHover(): void {
    if (snapshot.hover) update({ ...snapshot, hover: null });
    for (const preview of snapshot.previews) if (preview.getSnapshot().phase === "ready") send(preview, { type: "clear-hover" });
  }
  /** Drops only the navigating/disconnected preview's transient host state. */
  function replaced(screenId: string): void {
    if (snapshot.hover?.screenId === screenId) update({ ...snapshot, hover: null });
  }
  /** Changes mode once in the board store, then tells each isolated agent to change its own overlay. */
  function setMode(next: Mode): void {
    if (snapshot.mode === next) return;
    clearHover();
    update({ ...snapshot, mode: next });
    for (const preview of snapshot.previews) send(preview, { type: "mode", mode: next });
  }
  /** Applies V/I without hijacking editable text or browser modifier shortcuts. */
  function shortcut(key: string, editable: boolean, modified: boolean): void {
    if (editable || modified) return;
    if (key.toLowerCase() === "v") setMode("select");
    if (key.toLowerCase() === "i") setMode("interact");
  }
  /** Converts iframe-local zoom coordinates using only the host's iframe box and painted scale. */
  function receive(screenId: string, message: AgentMessage): void {
    if (message.type === "hover") {
      if (snapshot.mode !== "select" || dragging) return;
      if (!message.target && snapshot.hover?.screenId !== screenId) return;
      update({ ...snapshot, hover: message.target ? { screenId, target: message.target } : null });
    } else if (message.type === "key") {
      shortcut(message.key, message.editable, message.ctrlKey || message.metaKey || message.altKey);
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
  /** Forwards host-focused mode keys without stealing letters from editable controls. */
  function key(event: KeyboardEvent): void {
    const active = document.activeElement;
    const editable = !!active && (active.matches("input,textarea,select") || (active instanceof HTMLElement && active.isContentEditable));
    shortcut(event.key, editable, event.ctrlKey || event.metaKey || event.altKey);
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
      return createPreview(screen, region.target.ctx.scope, { mode, receive, replaced });
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
    update({ ...snapshot, previews: [], loading: true, hover: null, renderError: null });
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
    listeners.clear();
  }
  guard(region.target, load)();
  return { region, viewport, getSnapshot, subscribe, setMode, clearHover, setDragging, dispose };
}
export type BoardStore = ReturnType<typeof createBoard>;
