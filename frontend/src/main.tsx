// Boots scoped host failures and the disposable preview harness; the product board remains M3 work.
import { createRoot } from "react-dom/client";
import { guard } from "./core/guard";
import { installGlobalErrors, routeGlobalError } from "./core/global-errors";
import { enableDevLog } from "./core/dev-log";
import { createScope } from "./core/scope";
import { createFailureRegion } from "./stores/failure-region";
import { startHarness } from "./harness";
import { createRenderProbe, registerCoreProbes } from "./harness/failure-probes";
import { DevMenu } from "./ui/DevMenu";
import { FailureShell } from "./ui/FailureShell";
import { routeCaughtRender } from "./ui/RegionBoundary";
import "./ui/failures.css";

const lifetime = createScope();
const board = createFailureRegion("board", { screenId: null }, lifetime);
const preview = createFailureRegion("preview", { screenId: "m1-preview" }, lifetime);
const probe = createRenderProbe();
const visible = import.meta.env.DEV || new URLSearchParams(window.location.search).has("dev");
enableDevLog(visible);

/** Supplies the live board generation for genuinely unowned host-global errors. */
function boardTarget() { return board.target; }
const removeGlobals = installGlobalErrors(boardTarget);

/** Attributes React 19's early caught-error notification to its actual region before a global duplicate can arrive. */
function caught(error: unknown, info: { errorBoundary?: object | null }): void {
  routeCaughtRender(error, info, board.target);
}

/** Routes a root render failure through the same owner/dedupe path as a global catch. */
function uncaught(error: unknown): void { routeGlobalError(board.target, error); }

/** Creates temporary DOM islands and React-owned regional fallbacks without building a board feature. */
function mount(): void {
  const root = document.getElementById("root")!;
  const menu = document.createElement("div");
  const host = document.createElement("div");
  host.className = "failure-host";
  const harness = document.createElement("div");
  const overlays = document.createElement("div");
  root.append(menu, host);
  host.append(harness, overlays);
  let disposeHarness: (() => void) | undefined;

  /** Clears the injected render fault and replaces the disposed host island under the new retry generation. */
  function restart(): void {
    probe.clear();
    disposeHarness?.();
    preview.retry();
    disposeHarness = startHarness(harness, preview, board.target.ctx.scope);
  }

  const options = { onCaughtError: caught, onUncaughtError: uncaught };
  createRoot(menu, options).render(<DevMenu visible={visible} />);
  createRoot(overlays, options).render(<FailureShell board={board} preview={preview} probe={probe} restart={restart} />);
  if (visible) registerCoreProbes(board, preview, probe);
  restart();

  /** Silences callbacks and removes subscriptions when the document's owning lifetime ends. */
  function dispose(): void {
    disposeHarness?.();
    preview.dispose();
    board.dispose();
    removeGlobals();
    lifetime.dispose();
  }
  /** Keeps a cached document alive, but scopes actual document teardown to the current board generation. */
  function pageHide(event: PageTransitionEvent): void {
    if (!event.persisted) guard(board.target, dispose)();
  }
  window.addEventListener("pagehide", pageHide);
}

guard(board.target, mount)();
