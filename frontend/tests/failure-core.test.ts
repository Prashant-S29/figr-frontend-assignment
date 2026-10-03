// Verifies pure failure-core lifetimes, attribution and deduplication on Playwright's runner; no browser fixture is used.
import { test, expect } from "@playwright/test";
import { runAttempt } from "../src/core/attempt";
import { attributeError, fail } from "../src/core/fail";
import { guard } from "../src/core/guard";
import { routeGlobalError } from "../src/core/global-errors";
import { appendLog, getLogSnapshot } from "../src/core/log";
import { getReportCount } from "../src/core/report";
import { createScope } from "../src/core/scope";
import { scopedTimeout } from "../src/core/schedule";
import { getTriggerSnapshot, registerDevTrigger } from "../src/core/dev-registry";
import { createFailureRegion } from "../src/stores/failure-region";
import { RegionRenderBoundary, routeCaughtRender } from "../src/ui/RegionBoundary";

/** Creates controllable response arrival without network or browser timing. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  /** Captures the settlement functions owned by this single test request. */
  function capture(yes: (value: T) => void, no: (reason: unknown) => void): void { resolve = yes; reject = no; }
  const promise = new Promise<T>(capture);
  /** Supplies this request's pending result without creating another promise. */
  function load(): Promise<T> { return promise; }
  return { promise, resolve, reject, load };
}

/** Supplies an inert application callback for tests where publication must never matter. */
function noop(): void {}

/** Proves guard, React boundary/root and global catches share the same report identity and region. */
test("one error through guard, boundary and global is reported exactly once", () => {
  const row = createFailureRegion("layers-row", { screenId: "scr-05", elementKey: "setting-30-1" });
  const board = createFailureRegion("board", { screenId: null });
  const error = new Error("same occurrence");
  const before = getReportCount();
  /** Simulates a handler throwing the original object later caught by other entry points. */
  function handler(): void { throw error; }
  guard(row.target, handler)();
  const boundary = new RegionRenderBoundary({ target: row.target, children: null, retry: noop, testId: "row" });
  routeCaughtRender(error, { errorBoundary: boundary }, board.target);
  boundary.componentDidCatch(error);
  routeGlobalError(board.target, error);
  expect(getReportCount()).toBe(before + 1);
  expect(row.getSnapshot().failure?.context).toEqual({ region: "layers-row", screenId: "scr-05", elementKey: "setting-30-1" });
  expect(board.getSnapshot().failure).toBeNull();
  expect(getLogSnapshot().slice(-2).map(entry => entry.kind)).toEqual(["failure", "report"]);
  row.dispose(); board.dispose();
});

/** Proves cancelled load errors remain silent even when a global handler sees the same object later. */
test("cancelled attempt aborts its signal and never reports", async () => {
  const region = createFailureRegion("details", { screenId: "scr-01", elementKey: "cta-primary" });
  const board = createFailureRegion("board", { screenId: null });
  const response = deferred<number>();
  const error = new Error("cancelled response");
  const before = getReportCount();
  let applied = false;
  /** Marks an application that cancellation must suppress. */
  function apply(): void { applied = true; }
  const attempt = runAttempt(region.target, response.load, apply);
  attempt.cancel();
  expect(attempt.scope.signal.aborted).toBe(true);
  response.reject(error);
  await attempt.settled;
  routeGlobalError(board.target, error);
  expect(applied).toBe(false);
  expect(getReportCount()).toBe(before);
  expect(region.getSnapshot().failure).toBeNull();
  expect(board.getSnapshot().failure).toBeNull();
  region.dispose(); board.dispose();
});

/** Proves successful response arrival cannot mutate a region that no longer exists. */
test("late result after region disposal is ignored", async () => {
  const region = createFailureRegion("preview", { screenId: "scr-02" });
  const response = deferred<string>();
  const before = getReportCount();
  let value = "unchanged";
  /** Applies live data only; this callback must not run for the removed region. */
  function apply(result: string): void { value = result; }
  const attempt = runAttempt(region.target, response.load, apply);
  region.dispose();
  response.resolve("stale");
  await attempt.settled;
  expect(value).toBe("unchanged");
  expect(getReportCount()).toBe(before);
  expect(attempt.scope.alive).toBe(false);
});

/** Proves failure arrival after disposal is as silent as a late successful response. */
test("late rejection after region disposal is ignored", async () => {
  const region = createFailureRegion("layers", { screenId: "scr-04" });
  const response = deferred<string>();
  const before = getReportCount();
  const attempt = runAttempt(region.target, response.load, noop);
  region.dispose();
  response.reject(new Error("gone"));
  await attempt.settled;
  expect(getReportCount()).toBe(before);
  expect(region.getSnapshot().failure).toBeNull();
});

/** Proves exceptions during response application keep the request's region and element context. */
test("response application failure reports once in the original region", async () => {
  const region = createFailureRegion("details", { screenId: "scr-01", elementKey: "hero-banner" });
  const before = getReportCount();
  /** Simulates a live response callback throwing while applying validated data. */
  function apply(): void { throw new Error("apply failed"); }
  /** Supplies a live response whose application, rather than loading, will fail. */
  function load(): Promise<number> { return Promise.resolve(1); }
  await runAttempt(region.target, load, apply).settled;
  expect(getReportCount()).toBe(before + 1);
  expect(region.getSnapshot().failure?.context).toEqual({ region: "details", screenId: "scr-01", elementKey: "hero-banner" });
  region.dispose();
});

/** Proves a retry is a new scope and a fresh failed operation adds exactly one additional report. */
test("retry replaces scope and fresh failure counts as a new occurrence", () => {
  const region = createFailureRegion("inspector", { screenId: "scr-03" });
  const original = region.target;
  const error = new Error("first attempt");
  const before = getReportCount();
  fail(original.region, error, original.ctx);
  region.retry();
  expect(original.ctx.scope.alive).toBe(false);
  expect(region.getSnapshot().failure).toBeNull();
  fail(region.target.region, new Error("retry failed"), region.target.ctx);
  routeGlobalError(region.target, error);
  expect(getReportCount()).toBe(before + 2);
  expect(region.getSnapshot().failure?.message).toBe("retry failed");
  region.dispose();
});

/** Proves a reused Error is a fresh retry occurrence, while old catches never publish into the new generation. */
test("reused Error reports once per explicit retry generation", () => {
  const region = createFailureRegion("preview", { screenId: "scr-02" });
  const original = region.target;
  const error = new Error("persistent fault");
  const before = getReportCount();
  fail("preview", error, original.ctx);
  const firstId = region.getSnapshot().failure!.id;
  region.retry();
  routeGlobalError(region.target, error);
  expect(getReportCount()).toBe(before + 1);
  expect(region.getSnapshot().failure).toBeNull();
  /** Simulates the same persistent fault being thrown by explicitly entered retry work. */
  function retryWork(): void { throw error; }
  guard(region.target, retryWork)();
  const boundary = new RegionRenderBoundary({ target: region.target, children: null, retry: noop, testId: "preview" });
  boundary.componentDidCatch(error);
  routeGlobalError(region.target, error);
  fail("preview", error, original.ctx);
  expect(getReportCount()).toBe(before + 2);
  expect(region.getSnapshot().failure!.id).toBeGreaterThan(firstId);
  expect(region.getSnapshot().failure!.message).toBe("persistent fault");
  region.dispose();
});

/** Proves completing a child attempt cannot accidentally turn its error into another failure in the same parent generation. */
test("finished child attempt and parent boundary still dedupe one occurrence", async () => {
  const region = createFailureRegion("inspector", { screenId: "scr-03" });
  const board = createFailureRegion("board", { screenId: null });
  const error = new Error("child apply");
  const before = getReportCount();
  /** Supplies one live response for the child attempt. */
  function load(): Promise<number> { return Promise.resolve(1); }
  /** Throws the same object the parent boundary and global handler will subsequently see. */
  function apply(): void { throw error; }
  await runAttempt(region.target, load, apply).settled;
  const boundary = new RegionRenderBoundary({ target: region.target, children: null, retry: noop, testId: "inspector" });
  boundary.componentDidCatch(error);
  routeGlobalError(board.target, error);
  expect(getReportCount()).toBe(before + 1);
  expect(board.getSnapshot().failure).toBeNull();
  region.dispose(); board.dispose();
});

/** Proves an ignored cancelled error may count only after explicit new retry work throws it again. */
test("cancelled identity is silent until reused by explicit live retry work", async () => {
  const region = createFailureRegion("details", { screenId: "scr-01" });
  const response = deferred<number>();
  const error = new Error("reused cancelled error");
  const before = getReportCount();
  const attempt = runAttempt(region.target, response.load, noop);
  attempt.cancel(); response.reject(error);
  await attempt.settled;
  region.retry();
  routeGlobalError(region.target, error);
  expect(getReportCount()).toBe(before);
  fail("details", error, region.target.ctx);
  expect(getReportCount()).toBe(before + 1);
  region.dispose();
});

/** Proves superseded async work cannot overwrite the newest region generation. */
test("replacement attempt ignores the old result and applies only the new one", async () => {
  const region = createFailureRegion("details", { screenId: "scr-02" });
  const first = deferred<string>();
  const second = deferred<string>();
  const values: string[] = [];
  /** Records applied values to distinguish stale publication from mere response arrival. */
  function apply(value: string): void { values.push(value); }
  const old = runAttempt(region.target, first.load, apply);
  region.retry();
  const current = runAttempt(region.target, second.load, apply);
  second.resolve("new"); first.resolve("old");
  await Promise.all([old.settled, current.settled]);
  expect(values).toEqual(["new"]);
  region.dispose();
});

/** Proves guards catch returned promise rejection without losing the invocation's cancelled owner. */
test("async guard rejection after cancellation is silent", async () => {
  const region = createFailureRegion("preview", { screenId: "scr-06" });
  const response = deferred<void>();
  const before = getReportCount();
  guard(region.target, response.load)();
  region.dispose();
  response.reject(new Error("late async handler"));
  await response.promise.catch(noop);
  expect(getReportCount()).toBe(before);
});

/** Proves dead handlers are not invoked, rather than merely hiding errors they produce. */
test("guard does not execute dead entry points", () => {
  const region = createFailureRegion("board", { screenId: null });
  let invoked = false;
  /** Makes any unintended handler execution observable. */
  function work(): void { invoked = true; }
  const callback = guard(region.target, work);
  region.dispose(); callback();
  expect(invoked).toBe(false);
});

/** Proves genuinely unowned host errors use the board fallback and still share identity dedupe. */
test("unowned global error is attributed to the board exactly once", () => {
  const board = createFailureRegion("board", { screenId: null });
  const error = new Error("host global");
  const before = getReportCount();
  routeGlobalError(board.target, error); routeGlobalError(board.target, error);
  expect(getReportCount()).toBe(before + 1);
  expect(board.getSnapshot().failure?.context).toEqual({ region: "board", screenId: null });
  board.dispose();
});

/** Proves pre-attributed native/global work does not become a new board failure after its owner is cancelled. */
test("pre-attributed global error from a dead scope stays silent", () => {
  const preview = createFailureRegion("preview", { screenId: "scr-03" });
  const board = createFailureRegion("board", { screenId: null });
  const error = new Error("native callback after removal");
  const before = getReportCount();
  attributeError(error, preview.target);
  preview.dispose();
  routeGlobalError(board.target, error);
  expect(getReportCount()).toBe(before);
  expect(board.getSnapshot().failure).toBeNull();
  board.dispose();
});

/** Proves separate primitive throws are not falsely deduplicated by their equal text. */
test("primitive throws are distinct occurrences, not message-based dedupe", () => {
  const region = createFailureRegion("board", { screenId: null });
  const before = getReportCount();
  fail("board", "same text", region.target.ctx);
  fail("board", "same text", region.target.ctx);
  expect(getReportCount()).toBe(before + 2);
  expect(region.getSnapshot().failure?.message).toBe("same text");
  region.dispose();
});

/** Proves parent cancellation propagates to every child and a dead parent cannot spawn live work. */
test("scope disposal is idempotent and propagates to children", () => {
  const parent = createScope();
  const child = createScope(parent);
  const grandchild = createScope(child);
  parent.dispose(); parent.dispose();
  expect([parent, child, grandchild].every(scope => !scope.alive && scope.signal.aborted)).toBe(true);
  expect(createScope(parent).alive).toBe(false);
  const region = createFailureRegion("layers", { screenId: "scr-05" }, parent);
  region.retry();
  expect(region.target.ctx.scope.alive).toBe(false);
  region.dispose();
});

/** Proves cancellation removes scheduled timer work instead of allowing it to enter a dead region. */
test("disposed scope cancels a guarded timeout", async () => {
  const region = createFailureRegion("board", { screenId: null });
  const before = getReportCount();
  let invoked = false;
  /** Marks timer execution that should have been removed by scope disposal. */
  function work(): void { invoked = true; throw new Error("dead timer"); }
  scopedTimeout(region.target, work, 0);
  region.dispose();
  /** Waits for the next timer turn without launching a browser. */
  function nextTurn(resolve: () => void): void { setTimeout(resolve, 5); }
  await new Promise<void>(nextTurn);
  expect(invoked).toBe(false);
  expect(getReportCount()).toBe(before);
});

/** Proves sibling row owners remain isolated even when neither has a data-key. */
test("row failure does not mutate another row with identical report context", () => {
  const first = createFailureRegion("layers-row", { screenId: "scr-04" });
  const second = createFailureRegion("layers-row", { screenId: "scr-04" });
  fail("layers-row", new Error("first row only"), first.target.ctx);
  expect(first.getSnapshot().failure?.message).toBe("first row only");
  expect(second.getSnapshot().failure).toBeNull();
  first.dispose(); second.dispose();
});

/** Proves the diagnostic ring retains ordered bounded text/context snapshots without growing indefinitely. */
test("diagnostic ring keeps only the latest hundred entries in order", () => {
  for (let index = 0; index < 105; index++) appendLog("failure", new Error(`entry ${index}`), { region: "board", screenId: null });
  const snapshot = getLogSnapshot();
  expect(snapshot).toHaveLength(100);
  expect(snapshot[0].message).toBe("entry 5");
  expect(snapshot[99].message).toBe("entry 104");
  expect(snapshot.every((entry, index) => index === 0 || entry.id > snapshot[index - 1].id)).toBe(true);
  expect(getLogSnapshot()).toBe(snapshot);
});

/** Proves feature teardown cannot unregister a replacement dev action owned by a newer lifecycle. */
test("dev registry removal respects registration identity", () => {
  const board = createFailureRegion("board", { screenId: null });
  /** Supplies the current owner without giving a menu entry region-state mutation access. */
  function target() { return board.target; }
  const old = registerDevTrigger({ id: "unit-probe", label: "old", target, run: noop });
  const current = registerDevTrigger({ id: "unit-probe", label: "new", target, run: noop });
  const snapshot = getTriggerSnapshot();
  old();
  expect(getTriggerSnapshot()).toBe(snapshot);
  expect(snapshot.find(trigger => trigger.id === "unit-probe")?.label).toBe("new");
  current();
  expect(getTriggerSnapshot().some(trigger => trigger.id === "unit-probe")).toBe(false);
  board.dispose();
});
