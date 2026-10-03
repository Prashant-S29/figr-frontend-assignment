// Owns rAF-batched board coordinates and pointer-centred zoom; React and the agent never mutate the viewport.
import { scopedFrame } from "../core/schedule";
import type { FailureTarget } from "../core/fail";

export interface Viewport { readonly x: number; readonly y: number; readonly zoom: number }

/** Creates one board-generation viewport with coalesced input and constant screen-space pan distances. */
export function createViewport(target: () => FailureTarget, clearHover: () => void) {
  let snapshot: Viewport = { x: 40, y: 40, zoom: 1 };
  let pending = snapshot;
  let cancel: (() => void) | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();

  /** Publishes one complete transform per frame, never a per-wheel React update. */
  function flush(): void {
    cancel = undefined;
    snapshot = pending;
    for (const listener of listeners) listener();
  }
  /** Clears hover immediately and schedules at most one live frame for accumulated motion. */
  function schedule(): void {
    if (disposed) return;
    clearHover();
    if (!cancel) cancel = scopedFrame(target(), flush);
  }
  /** Applies empty-board drag/wheel distances in host pixels at every zoom. */
  function pan(dx: number, dy: number): void {
    if (disposed) return;
    pending = { ...pending, x: pending.x + dx, y: pending.y + dy };
    schedule();
  }
  /** Keeps the world point under the pointer fixed while clamping scale to 25–400%. */
  function zoomAt(x: number, y: number, delta: number): void {
    if (disposed) return;
    const zoom = Math.min(4, Math.max(0.25, pending.zoom * Math.exp(-delta * 0.002)));
    const ratio = zoom / pending.zoom;
    pending = { x: x - (x - pending.x) * ratio, y: y - (y - pending.y) * ratio, zoom };
    schedule();
  }
  /** Returns the last painted coordinates, not a not-yet-rendered input accumulation. */
  function getSnapshot(): Viewport { return snapshot; }
  /** Allows imperative board transforms and toolbar readers to share one painted snapshot. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Detaches only this viewport reader. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }
  /** Resets motion after a board retry, including a frame cancelled by its dead request generation. */
  function reset(): void {
    cancel?.();
    cancel = undefined;
    pending = { x: 40, y: 40, zoom: 1 };
    flush();
  }
  /** Prevents a removed board's queued drawing callback from mutating a replacement board. */
  function dispose(): void { disposed = true; cancel?.(); cancel = undefined; listeners.clear(); }
  return { getSnapshot, subscribe, pan, zoomAt, reset, dispose };
}
export type ViewportStore = ReturnType<typeof createViewport>;
