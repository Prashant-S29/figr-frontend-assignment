// Displays one screen's fixed-size iframe and isolated lifecycle/error UI; its store owns connection state and Retry.
import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { guard } from "../core/guard";
import type { PreviewStore } from "../stores/preview";
import { RegionBoundary } from "./RegionBoundary";

function PreviewFrame({ preview }: { preview: PreviewStore }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let detach: (() => void) | undefined;
    guard(preview.region.target, () => { detach = preview.attach(frame.current!); })();
    return () => guard(preview.region.target, () => detach?.())();
  }, [preview]);
  return <iframe ref={frame} data-testid={`iframe-${preview.screen.id}`} title={preview.screen.name} width="1280" height="800" sandbox="allow-scripts allow-same-origin allow-forms" />;
}

export const Preview = memo(function Preview({ preview }: { preview: PreviewStore }) {
  const state = useSyncExternalStore(preview.subscribe, preview.getSnapshot);
  return <article className="preview" data-testid={`preview-${preview.screen.id}`} data-connection={state.phase} data-instance-id={state.instanceId ?? ""}>
    <header className="preview-heading">
      <h2 data-testid={`screen-name-${preview.screen.id}`}>{preview.screen.name}</h2>
      {state.pageError ? <span className="page-error" data-testid={`page-error-${preview.screen.id}`} title={state.pageError}>Page error</span> : null}
    </header>
    <div className="preview-surface">
      <RegionBoundary region={preview.region} testId={`preview-${preview.screen.id}`}>
        <PreviewFrame preview={preview} />
        {state.phase === "connecting" ? <span className="connecting" data-testid={`connecting-${preview.screen.id}`}>Connecting…</span> : null}
      </RegionBoundary>
    </div>
  </article>;
});
