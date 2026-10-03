// Verifies D5's pure sibling matching order and ambiguity rejection without a browser or DOM implementation.
import { expect, test } from "@playwright/test";
import { matchChildren, type MatchIdentity } from "../../agent/src/reconcile";

/** Builds concise matching evidence while keeping every criterion explicit in assertions. */
function identity(token: string, values: Partial<Omit<MatchIdentity, "token">> = {}): MatchIdentity {
  return { token, dataKey: null, domId: null, strict: `${token}:strict`, relaxed: `${token}:relaxed`, ...values };
}

/** Proves data-key wins before conflicting weaker signatures. */
test("matches a unique data-key before strict or relaxed evidence", () => {
  const previous = [identity("old", { dataKey: "activity-7", strict: "shared", relaxed: "shared" })];
  const current = [
    identity("wrong", { dataKey: "activity-9", strict: "shared", relaxed: "shared" }),
    identity("right", { dataKey: "activity-7", strict: "different", relaxed: "different" }),
  ];
  expect([...matchChildren(previous, current)]).toEqual([["old", "right"]]);
});

/** Proves a unique DOM id is used when data-key evidence is absent. */
test("matches a unique id after data-key", () => {
  const previous = [identity("old", { domId: "feed", strict: "old" })];
  const current = [identity("right", { domId: "feed", strict: "new" })];
  expect(matchChildren(previous, current).get("old")).toBe("right");
});

/** Proves an exact tag, attributes and normalized-text signature preserves an unkeyed identity. */
test("matches a unique strict signature", () => {
  const previous = [identity("old", { strict: "li|Ada shipped|2s", relaxed: "li|Ada shipped|s" })];
  const current = [identity("right", { strict: "li|Ada shipped|2s", relaxed: "li|Ada shipped|s" })];
  expect(matchChildren(previous, current).get("old")).toBe("right");
});

/** Proves digit-stripped evidence is the final fallback for changing relative-time text. */
test("matches a unique relaxed signature after digits change", () => {
  const previous = [identity("old", { strict: "li|Ada|2s", relaxed: "li|Ada|s" })];
  const current = [identity("right", { strict: "li|Ada|4s", relaxed: "li|Ada|s" })];
  expect(matchChildren(previous, current).get("old")).toBe("right");
});

/** Proves two current lookalikes are ambiguous and therefore never guessed by position. */
test("rejects ambiguous current siblings", () => {
  const previous = [identity("old", { strict: "same", relaxed: "same" })];
  const current = [
    identity("first", { strict: "same", relaxed: "same" }),
    identity("second", { strict: "same", relaxed: "same" }),
  ];
  expect(matchChildren(previous, current).has("old")).toBe(false);
});

/** Proves ambiguity at stronger keyed evidence cannot be guessed later from a weaker signature. */
test("does not fall through after ambiguous keyed evidence", () => {
  const previous = [identity("old", { dataKey: "duplicate", strict: "distinct-a", relaxed: "a" })];
  const current = [
    identity("candidate-a", { dataKey: "duplicate", strict: "distinct-a", relaxed: "a" }),
    identity("candidate-b", { dataKey: "duplicate", strict: "distinct-b", relaxed: "b" }),
  ];
  expect(matchChildren(previous, current).has("old")).toBe(false);
});

/** Proves multiple indistinguishable old identities cannot collapse onto one current node. */
test("rejects ambiguous previous siblings", () => {
  const previous = [
    identity("old-a", { strict: "same", relaxed: "same" }),
    identity("old-b", { strict: "same", relaxed: "same" }),
  ];
  const current = [identity("new", { strict: "same", relaxed: "same" })];
  expect(matchChildren(previous, current).size).toBe(0);
});
