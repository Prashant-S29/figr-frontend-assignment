// Projects tracked geometry into an unscaled screen-space layer; selection and viewport stores own state and the host never reads child DOM.
import { useEffect, useRef } from "react";
import type { Geometry } from "../../../shared/protocol";
import { guard } from "../core/guard";
import { scopedFrame } from "../core/schedule";
import type { BoardStore } from "../stores/board";

function framePosition(frame: HTMLIFrameElement) {
  let x = 0;
  let y = 0;
  let element: HTMLElement | null = frame;
  while (element && element.dataset.testid !== "board-world") {
    x += element.offsetLeft;
    y += element.offsetTop;
    element = element.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function outline(geometry: Geometry, zoom: number, kind: "hover" | "selection") {
  if (!geometry.box || !geometry.clip) return null;
  const { box, clip } = geometry;
  const container = document.createElement("div");
  container.className = `outline-item outline-${kind}`;
  container.dataset.testid = `${kind}-outline`;
  container.dataset.elementId = geometry.elementId;
  const mask = document.createElement("div");
  mask.className = "outline-mask";
  Object.assign(mask.style, { left: `${clip.x * zoom}px`, top: `${clip.y * zoom}px`, width: `${clip.width * zoom}px`, height: `${clip.height * zoom}px` });
  const border = document.createElement("div");
  border.className = "outline-border";
  border.dataset.testid = `${kind}-border`;
  Object.assign(border.style, { left: `${(box.x - clip.x) * zoom}px`, top: `${(box.y - clip.y) * zoom}px`, width: `${box.width * zoom}px`, height: `${box.height * zoom}px` });
  mask.append(border);
  const label = document.createElement("div");
  label.className = "outline-label";
  label.dataset.testid = `${kind}-label`;
  label.textContent = geometry.name;
  const below = clip.y * zoom < 20;
  label.dataset.placement = below ? "below" : "above";
  Object.assign(label.style, { left: `${clip.x * zoom}px`, top: `${below ? (clip.y + clip.height) * zoom : clip.y * zoom - 20}px` });
  container.append(mask, label);
  return container;
}

export function Outlines({ board }: { board: BoardStore }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current!;
    let cancelResize: (() => void) | undefined;
    const draw = () => {
      const inspection = board.selection.getSnapshot();
      const state = board.getSnapshot();
      const viewport = board.viewport.getSnapshot();
      const fragment = document.createDocumentFragment();
      if (state.mode === "select" || inspection.drawFault) {
        const screens = new Set(state.mode === "select" ? [inspection.hover?.screenId, inspection.screenId] : []);
        if (inspection.drawFault) screens.add(inspection.drawFault.screenId);
        for (const screenId of screens) {
          if (!screenId) continue;
          const preview = state.previews.find(item => item.screen.id === screenId);
          if (!preview || preview.getSnapshot().phase !== "ready") continue;
          const drawPreview = () => {
            if (inspection.drawFault?.screenId === screenId) throw inspection.drawFault.error;
            const frame = preview.getFrame();
            if (!frame) return;
            const position = framePosition(frame);
            const group = document.createElement("div");
            group.className = "outline-preview";
            group.dataset.testid = `outlines-${screenId}`;
            group.dataset.screenId = screenId;
            Object.assign(group.style, { left: `${viewport.x + position.x * viewport.zoom}px`, top: `${viewport.y + position.y * viewport.zoom}px`, width: `${1280 * viewport.zoom}px`, height: `${800 * viewport.zoom}px` });
            const measured = inspection.geometry.get(screenId);
            const append = (id: string, kind: "hover" | "selection") => {
              const geometry = measured?.get(id);
              const item = geometry ? outline(geometry, viewport.zoom, kind) : null;
              if (item) group.append(item);
            };
            if (inspection.hover?.screenId === screenId) append(inspection.hover.target.elementId, "hover");
            if (inspection.screenId === screenId) for (const target of inspection.targets) append(target.elementId, "selection");
            fragment.append(group);
          };
          guard(preview.getTarget(), drawPreview)();
        }
      }
      element.replaceChildren(fragment);
    };
    const paint = () => guard(board.region.target, draw)();
    const resize = () => {
      cancelResize?.();
      cancelResize = scopedFrame(board.region.target, draw);
    };
    const removeInspection = board.selection.subscribe(paint);
    const removeViewport = board.viewport.subscribe(paint);
    const removeBoard = board.subscribe(paint);
    window.addEventListener("resize", resize);
    paint();
    return () => {
      cancelResize?.();
      removeInspection();
      removeViewport();
      removeBoard();
      window.removeEventListener("resize", resize);
      element.replaceChildren();
    };
  }, [board]);
  return <div className="outlines" data-testid="outline-layer" ref={root} />;
}
