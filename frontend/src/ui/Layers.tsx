// Renders the active preview's fixed-row lazy tree, regional loading failures and keyboard focus; the Layers store owns all tree and sync state.
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { guard } from "../core/guard";
import { visibleTreeRows } from "../stores/layers-tree";
import type { LayersSnapshot, LayersStore } from "../stores/layers";
import { RegionBoundary } from "./RegionBoundary";

function RowStatus({ store, snapshot, elementId, depth }: { store: LayersStore; snapshot: LayersSnapshot; elementId: string; depth: number }) {
  const state = snapshot.rows.get(elementId);
  if (!snapshot.expanded.has(elementId) || !state || state.kind === "loaded") return null;
  const content = <div className="layers-row-status" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }} data-testid={`layers-row-status-${elementId}`}>
    {state.kind === "loading" ? "Loading…" : null}
  </div>;
  return <RegionBoundary region={state.region} onRetry={() => store.retryRow(elementId)} testId={`layers-row-${elementId}`}>{content}</RegionBoundary>;
}

function Tree({ store, snapshot }: { store: LayersStore; snapshot: LayersSnapshot }) {
  const tree = useRef<HTMLDivElement>(null);
  const rows = visibleTreeRows({ roots: snapshot.roots, children: snapshot.children, parents: snapshot.parents, expanded: snapshot.expanded });
  useEffect(() => {
    if (!tree.current?.contains(document.activeElement) || !snapshot.focusedId) return;
    document.getElementById(`layer-button-${snapshot.focusedId}`)?.focus({ preventScroll: true });
  }, [snapshot.focusedId]);
  useEffect(() => {
    if (!snapshot.scrollId) return;
    document.getElementById(`layer-row-${snapshot.scrollId}`)?.scrollIntoView({ block: "nearest" });
  }, [snapshot.scrollRevision, snapshot.scrollId]);
  const target = snapshot.region!.target;
  const keyDown = guard(target, (event: ReactKeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    store.key(event.key);
  });
  const focus = guard(target, () => store.focusFirst());
  return <div className="layers-tree" role="tree" tabIndex={0} ref={tree} onKeyDown={keyDown} onFocus={focus} data-testid="layers-tree">
    {rows.map(({ elementId, depth }) => {
      const node = snapshot.nodes.get(elementId);
      if (!node) return null;
      const expanded = snapshot.expanded.has(elementId);
      return <div key={elementId}>
        <div
          id={`layer-row-${elementId}`}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={node.hasChildren ? expanded : undefined}
          aria-selected={snapshot.selected.has(elementId)}
          className={`layers-row${snapshot.selected.has(elementId) ? " is-selected" : ""}${snapshot.hoveredId === elementId ? " is-hovered" : ""}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          data-testid={`layer-row-${elementId}`}
          data-layer-id={elementId}
          onPointerOver={guard(target, () => store.hoverRow(elementId))}
          onPointerOut={guard(target, (event: ReactPointerEvent) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) store.hoverRow(null);
          })}
        >
          {node.hasChildren
            ? <button type="button" className="layers-chevron" aria-label={expanded ? "Collapse" : "Expand"} data-testid={`layer-toggle-${elementId}`} onClick={guard(target, () => store.toggle(elementId))}>{expanded ? "▾" : "▸"}</button>
            : <span className="layers-chevron-spacer" />}
          <button
            id={`layer-button-${elementId}`}
            type="button"
            className="layers-name"
            tabIndex={snapshot.focusedId === elementId ? 0 : -1}
            data-testid={`layer-name-${elementId}`}
            onFocus={guard(target, () => store.focusRow(elementId))}
            onClick={guard(target, event => store.selectRow(elementId, event.shiftKey))}
          >{node.name}</button>
        </div>
        <RowStatus store={store} snapshot={snapshot} elementId={elementId} depth={depth} />
      </div>;
    })}
  </div>;
}

function LayersContent({ store, snapshot }: { store: LayersStore; snapshot: LayersSnapshot }) {
  if (snapshot.renderError) throw snapshot.renderError;
  if (snapshot.rootLoading) return <p data-testid="layers-loading">Loading…</p>;
  return <Tree store={store} snapshot={snapshot} />;
}

export function Layers({ store }: { store: LayersStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <aside className="layers" data-testid="layers">
    <h2>Layers</h2>
    {!snapshot.screenId ? <p data-testid="layers-empty">Click something in a preview</p> : null}
    {snapshot.region
      ? <RegionBoundary key={snapshot.revision} region={snapshot.region} onRetry={store.retryLayers} testId="layers">
        <LayersContent store={store} snapshot={snapshot} />
      </RegionBoundary>
      : null}
  </aside>;
}
