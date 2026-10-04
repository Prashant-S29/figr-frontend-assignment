// Owns the document-lifetime host theme; preview styles, product inspection state and reload persistence are deliberately excluded.
export type Theme = "light" | "dark";

/** Creates the dashboard's Light/Dark owner independently of board Retry and preview lifetimes. */
export function createTheme() {
  let snapshot: Theme = "light";
  const listeners = new Set<() => void>();

  /** Exposes a stable primitive snapshot for React readers. */
  function getSnapshot(): Theme { return snapshot; }

  /** Switches only host presentation and notifies readers without touching previews or requests. */
  function toggle(): void {
    snapshot = snapshot === "light" ? "dark" : "light";
    for (const listener of listeners) listener();
  }

  /** Registers a theme view without granting it direct mutation. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Removes only this theme reader. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }

  /** Ends host presentation subscriptions when the document's product lifetime ends. */
  function dispose(): void { listeners.clear(); }

  return { getSnapshot, toggle, subscribe, dispose };
}

export type ThemeStore = ReturnType<typeof createTheme>;
