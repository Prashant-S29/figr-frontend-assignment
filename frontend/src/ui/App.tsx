// Presents interaction/theme toolbar controls and isolated product regions; stores own shared state and iframe presentation is untouched.
import { useSyncExternalStore } from "react";
import { guard } from "../core/guard";
import type { BoardStore } from "../stores/board";
import type { ThemeStore } from "../stores/theme";
import { Board } from "./Board";
import { RegionBoundary } from "./RegionBoundary";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";

function Toolbar({ board, theme }: { board: BoardStore; theme: ThemeStore }) {
  const palette = useSyncExternalStore(theme.subscribe, theme.getSnapshot);
  const { mode } = useSyncExternalStore(board.subscribe, board.getSnapshot);
  const { zoom } = useSyncExternalStore(board.viewport.subscribe, board.viewport.getSnapshot);
  return <header className="toolbar" data-testid="toolbar">
    <h1>Figr Viewer</h1>
    <div role="group" aria-label="Interaction mode">
      <button type="button" data-testid="select-mode" aria-pressed={mode === "select"} onClick={guard(board.region.target, () => board.setMode("select"))}>Select (V)</button>
      <button type="button" data-testid="interact-mode" aria-pressed={mode === "interact"} onClick={guard(board.region.target, () => board.setMode("interact"))}>Interact (I)</button>
    </div>
    <output data-testid="zoom-level">{Math.round(zoom * 100)}%</output>
    <span data-testid="mode">{mode}</span>
    <button type="button" className="theme-toggle" data-testid="theme-toggle" aria-label="Dark theme" aria-pressed={palette === "dark"} title={`Switch to ${palette === "light" ? "dark" : "light"} theme`} onClick={guard(board.region.target, theme.toggle)}>Theme: {palette === "light" ? "Light" : "Dark"}</button>
  </header>;
}

export function App({ board, theme }: { board: BoardStore; theme: ThemeStore }) {
  return <main className="app" data-testid="app">
    <Toolbar board={board} theme={theme} />
    <div className="workspace" data-testid="workspace">
      <Layers store={board.layers} />
      <section className="board-region" data-testid="board-region">
        <RegionBoundary region={board.region} testId="board"><Board board={board} /></RegionBoundary>
      </section>
      <Inspector store={board.inspector} />
    </div>
  </main>;
}
