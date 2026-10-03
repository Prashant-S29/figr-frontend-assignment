// Derives fixed-order visible Layers rows and collapsed-ancestor highlights; requests, selection and React rendering stay elsewhere.
export interface TreeRelations {
  readonly roots: readonly string[];
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly parents: ReadonlyMap<string, string | null>;
  readonly expanded: ReadonlySet<string>;
}

export interface VisibleTreeRow {
  readonly elementId: string;
  readonly depth: number;
}

/** Flattens only loaded expanded branches in document order without changing remembered expansion state. */
export function visibleTreeRows(tree: TreeRelations): readonly VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];
  const seen = new Set<string>();
  /** Adds one branch while rejecting accidental cycles from malformed or stale relationship state. */
  function visit(elementId: string, depth: number): void {
    if (seen.has(elementId)) return;
    seen.add(elementId);
    rows.push({ elementId, depth });
    if (!tree.expanded.has(elementId)) return;
    for (const childId of tree.children.get(elementId) ?? []) visit(childId, depth + 1);
  }
  for (const rootId of tree.roots) visit(rootId, 0);
  return rows;
}

/** Maps a known hovered identity to itself or its nearest currently visible collapsed ancestor. */
export function nearestVisibleRow(elementId: string, tree: TreeRelations): string | null {
  const visible = new Set(visibleTreeRows(tree).map(row => row.elementId));
  const seen = new Set<string>();
  let current: string | null | undefined = elementId;
  while (current !== null && current !== undefined && !seen.has(current)) {
    if (visible.has(current)) return current;
    seen.add(current);
    current = tree.parents.get(current);
  }
  return null;
}
