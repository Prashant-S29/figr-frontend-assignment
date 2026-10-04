// Boots document-lifetime board/theme owners and shared failure routing; preview DOM access remains exclusively in the cross-origin agent.
import { createRoot } from "react-dom/client";
import { guard } from "./core/guard";
import { installGlobalErrors, routeGlobalError } from "./core/global-errors";
import { enableDevLog } from "./core/dev-log";
import { createScope } from "./core/scope";
import { createFailureRegion } from "./stores/failure-region";
import { createBoard } from "./stores/board";
import { createTheme } from "./stores/theme";
import { App } from "./ui/App";
import { DevMenu } from "./ui/DevMenu";
import { routeCaughtRender } from "./ui/RegionBoundary";
import { ThemeSurface } from "./ui/ThemeSurface";
import "./ui/theme.css";
import "./ui/failures.css";
import "./ui/board.css";
import "./ui/outlines.css";
import "./ui/layers.css";
import "./ui/inspector.css";

const lifetime = createScope();
const region = createFailureRegion("board", { screenId: null }, lifetime);
const visible = import.meta.env.DEV || new URLSearchParams(window.location.search).has("dev");
enableDevLog(visible);

/** Supplies a live board generation for genuinely unowned host-global errors. */
function boardTarget() { return region.target; }
const removeGlobals = installGlobalErrors(boardTarget);

/** Attributes React's early caught notification before a duplicate boundary/global delivery. */
function caught(error: unknown, info: { errorBoundary?: object | null }): void { routeCaughtRender(error, info, region.target); }
/** Feeds root render errors through the same scoped exact-once failure path. */
function uncaught(error: unknown): void { routeGlobalError(region.target, error); }

/** Mounts the host theme scope and product root with independently owned screen/preview lifetimes. */
function mount(): void {
  const board = createBoard(region, visible);
  const theme = createTheme();
  createRoot(document.getElementById("root")!, { onCaughtError: caught, onUncaughtError: uncaught }).render(<ThemeSurface store={theme}><DevMenu visible={visible} /><App board={board} theme={theme} /></ThemeSurface>);
  /** Disposes every native listener, port, request and theme reader before ending the host document's scope. */
  function dispose(): void { board.dispose(); theme.dispose(); region.dispose(); removeGlobals(); lifetime.dispose(); }
  /** Keeps a bfcache document alive while making actual teardown's late callbacks silent. */
  function pageHide(event: PageTransitionEvent): void { if (!event.persisted) guard(region.target, dispose)(); }
  window.addEventListener("pagehide", pageHide);
}
guard(region.target, mount)();
