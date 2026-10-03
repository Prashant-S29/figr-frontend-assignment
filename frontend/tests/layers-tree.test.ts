// Verifies pure Layers order, hover ancestry, derived search and mutation replacement without a browser or page DOM.
import { expect, test } from "@playwright/test";
import { nearestVisibleRow, replaceTreeLevels, searchTree, visibleTreeRows, type TreeRelations } from "../src/stores/layers-tree";

/** Builds one nested tree while keeping expansion independent from loaded child relationships. */
function tree(expanded: readonly string[]): TreeRelations {
  return {
    roots: ["a", "b"],
    children: new Map([
      ["a", ["a1", "a2"]],
      ["a2", ["deep"]],
    ]),
    parents: new Map([
      ["a", null],
      ["b", null],
      ["a1", "a"],
      ["a2", "a"],
      ["deep", "a2"],
    ]),
    expanded: new Set(expanded),
  };
}

/** Proves flattening preserves document order and includes descendants only through expanded ancestors. */
test("flattens only visible expanded branches", () => {
  expect(visibleTreeRows(tree(["a", "a2"]))).toEqual([
    { elementId: "a", depth: 0 },
    { elementId: "a1", depth: 1 },
    { elementId: "a2", depth: 1 },
    { elementId: "deep", depth: 2 },
    { elementId: "b", depth: 0 },
  ]);
  expect(visibleTreeRows(tree([]))).toEqual([
    { elementId: "a", depth: 0 },
    { elementId: "b", depth: 0 },
  ]);
});

/** Proves preview hover highlights the nearest visible collapsed ancestor without expanding state. */
test("projects hidden hover to the nearest visible ancestor", () => {
  expect(nearestVisibleRow("deep", tree([]))).toBe("a");
  expect(nearestVisibleRow("deep", tree(["a"]))).toBe("a2");
  expect(nearestVisibleRow("deep", tree(["a", "a2"]))).toBe("deep");
});

/** Proves unknown identities and malformed parent cycles cannot hang or invent a visible row. */
test("rejects unknown and cyclic hidden ancestry", () => {
  const cyclic: TreeRelations = { roots: [], children: new Map(), parents: new Map([["x", "y"], ["y", "x"]]), expanded: new Set() };
  expect(nearestVisibleRow("missing", tree([]))).toBeNull();
  expect(nearestVisibleRow("x", cyclic)).toBeNull();
});

/** Describes test-only tree metadata without relying on sibling positions for identity. */
function node(elementId: string) { return { elementId, name: elementId, dataKey: null, hasChildren: true }; }

/** Proves whole-tree paths form a deduplicated derived view without mutating the lazy expansion snapshot. */
test("search includes ancestors in order and does not change expansion", () => {
  const lazy = tree(["a"]);
  const before = new Set(lazy.expanded);
  const projection = searchTree([[node("a"), node("a2"), node("deep")], [node("b")], [node("a"), node("a2"), node("other")]]);
  expect(visibleTreeRows(projection).map(row => row.elementId)).toEqual(["a", "a2", "deep", "other", "b"]);
  expect(lazy.expanded).toEqual(before);
  expect(searchTree([]).roots).toEqual([]);
});

/** Proves inserts replace a level once while surviving rows retain their exact expansion identities. */
test("live level replacement retains surviving expansion without duplicate children", () => {
  const lazy = { ...tree(["a", "a2"]), nodes: new Map(["a", "b", "a1", "a2", "deep"].map(id => [id, node(id)])) };
  const result = replaceTreeLevels(lazy, [{ parentElementId: "a", children: [node("new"), node("a1"), node("a2")] }]);
  expect(result.children.get("a")).toEqual(["new", "a1", "a2"]);
  expect(result.expanded).toEqual(lazy.expanded);
  expect(result.removed.size).toBe(0);
  expect(lazy.children.get("a")).toEqual(["a1", "a2"]);
});

/** Proves removing a subtree prunes stale rows, parent links and expansion without altering a sibling. */
test("live removal prunes the full detached subtree", () => {
  const lazy = { ...tree(["a", "a2"]), nodes: new Map(["a", "b", "a1", "a2", "deep"].map(id => [id, node(id)])) };
  const result = replaceTreeLevels(lazy, [{ parentElementId: "a", children: [node("a1")] }]);
  expect(result.removed).toEqual(new Set(["a2", "deep"]));
  expect(result.nodes.has("deep")).toBe(false);
  expect(result.parents.has("deep")).toBe(false);
  expect(result.expanded).toEqual(new Set(["a"]));
  expect(result.roots).toEqual(["a", "b"]);
});

/** Proves a reference-surviving move represented in the same batch keeps its expansion and children. */
test("live moves preserve surviving identities across parents", () => {
  const lazy = { ...tree(["a", "a2"]), nodes: new Map(["a", "b", "a1", "a2", "deep"].map(id => [id, node(id)])) };
  const result = replaceTreeLevels(lazy, [{ parentElementId: "a", children: [node("a1")] }, { parentElementId: "b", children: [node("a2")] }]);
  expect(result.parents.get("a2")).toBe("b");
  expect(result.children.get("a2")).toEqual(["deep"]);
  expect(result.expanded.has("a2")).toBe(true);
  expect(result.removed.size).toBe(0);
});
