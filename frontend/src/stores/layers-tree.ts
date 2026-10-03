// Derives visible rows, isolated search projections and complete live-level replacement; request lifetimes, selection and React rendering stay elsewhere.
import type { TreeLevel, TreeNode } from "../../../shared/protocol";

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

/** Builds an independent search projection in document order, including ancestors without touching the lazy tree. */
export function searchTree(paths: readonly (readonly TreeNode[])[]) {
  const roots: string[] = [];
  const nodes = new Map<string, TreeNode>();
  const children = new Map<string, string[]>();
  const parents = new Map<string, string | null>();
  const expanded = new Set<string>();
  for (const path of paths) {
    for (let index = 0; index < path.length; index += 1) {
      const node = path[index];
      const parentId = index ? path[index - 1].elementId : null;
      nodes.set(node.elementId, node);
      parents.set(node.elementId, parentId);
      const siblings = parentId === null ? roots : children.get(parentId) ?? [];
      if (!siblings.includes(node.elementId)) siblings.push(node.elementId);
      if (parentId !== null) { children.set(parentId, siblings); expanded.add(parentId); }
    }
  }
  return { roots, nodes, children, parents, expanded };
}

/** Replaces live loaded levels and prunes removed subtrees without disturbing surviving expansion or row order. */
export function replaceTreeLevels<T extends TreeRelations & { readonly nodes: ReadonlyMap<string, TreeNode> }>(tree: T, levels: readonly TreeLevel[]) {
  const nodes = new Map(tree.nodes);
  const parents = new Map(tree.parents);
  const children = new Map(tree.children);
  const expanded = new Set(tree.expanded);
  let roots = tree.roots;
  for (const level of levels) {
    const ids = level.children.map(node => node.elementId);
    if (level.parentElementId === null) roots = ids;
    else children.set(level.parentElementId, ids);
    for (const node of level.children) {
      nodes.set(node.elementId, node);
      parents.set(node.elementId, level.parentElementId);
    }
  }
  const removed = new Set<string>();
  /** Removes only stale parent relations, preserving real moves represented elsewhere in the same batch. */
  function prune(elementId: string): void {
    if (removed.has(elementId)) return;
    removed.add(elementId);
    for (const child of children.get(elementId) ?? []) if (parents.get(child) === elementId) prune(child);
    nodes.delete(elementId);
    parents.delete(elementId);
    children.delete(elementId);
    expanded.delete(elementId);
  }
  for (const level of levels) {
    const oldIds = level.parentElementId === null ? tree.roots : tree.children.get(level.parentElementId) ?? [];
    const nextIds = new Set(level.children.map(node => node.elementId));
    for (const id of oldIds) if (!nextIds.has(id) && parents.get(id) === level.parentElementId) prune(id);
  }
  return { roots, nodes, parents, children, expanded, removed };
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
