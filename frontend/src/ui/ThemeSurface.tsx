// Projects the host theme into one scoped CSS surface; children retain their instances and iframe documents remain independent.
import { useSyncExternalStore, type ReactNode } from "react";
import type { ThemeStore } from "../stores/theme";

export function ThemeSurface({ store, children }: { store: ThemeStore; children: ReactNode }) {
  const theme = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <div className="viewer" data-testid="viewer-theme" data-theme={theme}>{children}</div>;
}
