// Verifies the pure Layers visible-row order and collapsed-ancestor hover projection without a browser or page DOM.
import { expect, test } from "@playwright/test";
import { nearestVisibleRow, visibleTreeRows, type TreeRelations } from "../src/stores/layers-tree";

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
