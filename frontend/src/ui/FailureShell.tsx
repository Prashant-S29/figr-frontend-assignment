// Mounts temporary M2 region fallbacks around the existing harness; it does not implement the product board or preview lifecycle.
import { useSyncExternalStore } from "react";
import type { RenderProbe } from "../harness/failure-probes";
import type { FailureRegion } from "../stores/failure-region";
import { RegionBoundary } from "./RegionBoundary";

function Probe({ probe }: { probe: RenderProbe }) {
  const error = useSyncExternalStore(probe.subscribe, probe.getSnapshot);
  if (error) throw error;
  return null;
}

export function FailureShell({ board, preview, probe, restart }: { board: FailureRegion; preview: FailureRegion; probe: RenderProbe; restart: () => void }) {
  return <>
    <div className="preview-failure-overlay">
      <RegionBoundary region={preview} testId="preview">{null}</RegionBoundary>
    </div>
    <div className="failure-overlay">
      <RegionBoundary region={board} testId="board" onRetry={restart}><Probe probe={probe} /></RegionBoundary>
    </div>
  </>;
}
