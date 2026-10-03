// Projects the rAF-batched viewport into CSS and routes host input; stores alone own board, mode and preview state.
import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { guard } from "../core/guard";
import type { BoardStore } from "../stores/board";
import type { PreviewStore } from "../stores/preview";
import { Preview } from "./Preview";

const Grid = memo(function Grid({ previews }: { previews: readonly PreviewStore[] }) {
  return <>{previews.map(preview => <Preview key={preview.screen.id} preview={preview} />)}</>;
});

export function Board({ board }: { board: BoardStore }) {
  const snapshot = useSyncExternalStore(board.subscribe, board.getSnapshot);
  const canvas = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const scene = world.current!;
    let drag: { id: number; x: number; y: number } | null = null;
    const paint = () => {
      const { x, y, zoom } = board.viewport.getSnapshot();
      scene.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      element.dataset.x = String(x);
      element.dataset.y = String(y);
      element.dataset.zoom = String(zoom);
    };
    const hover = () => {
      const current = board.getSnapshot().hover;
      element.dataset.hoverScreen = current?.screenId ?? "";
      element.dataset.hoverElement = current?.target.elementId ?? "";
    };
    const protect = <E extends Event,>(work: (event: E) => void) => (event: E) => guard(board.region.target, work)(event);
    const empty = (target: EventTarget | null) => target === element || target === scene;
    const down = protect((event: PointerEvent) => {
      if (event.button !== 0 || !empty(event.target)) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      board.setDragging(true);
    });
    const move = protect((event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      board.viewport.pan(event.clientX - drag.x, event.clientY - drag.y);
      drag = { id: drag.id, x: event.clientX, y: event.clientY };
    });
    const up = protect((event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag = null;
      board.setDragging(false);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    });
    const wheel = protect((event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !empty(event.target)) return;
      event.preventDefault();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      board.viewport.pan(-event.deltaX * factor, -event.deltaY * factor);
    });
    const zoom = protect((event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      board.viewport.zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY * factor);
    });
    const leave = protect(() => board.clearHover());
    const removeViewport = board.viewport.subscribe(guard(board.region.target, paint));
    const removeHover = board.subscribe(guard(board.region.target, hover));
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("lostpointercapture", up);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("wheel", zoom, { passive: false, capture: true });
    guard(board.region.target, paint)();
    guard(board.region.target, hover)();
    return () => {
      removeViewport();
      removeHover();
      board.setDragging(false);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("lostpointercapture", up);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("wheel", zoom, { capture: true });
    };
  }, [board]);
  if (snapshot.renderError) throw snapshot.renderError;
  return <div className="board" data-testid="board" ref={canvas}>
    {snapshot.loading ? <p className="board-loading" data-testid="screens-loading">Loading screens…</p> : null}
    <div className="board-world" data-testid="board-world" ref={world}><Grid previews={snapshot.previews} /></div>
  </div>;
}
