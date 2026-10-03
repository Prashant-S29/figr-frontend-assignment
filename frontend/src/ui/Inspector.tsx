// Renders Inspector Live/Details snapshots and nested regional fallbacks; stores own selection projection, requests and retries.
import { useSyncExternalStore } from "react";
import type { InspectorLive, InspectorSnapshot, InspectorStore } from "../stores/inspector";
import { RegionBoundary } from "./RegionBoundary";

const fields = [
  ["name", "Name", (value: InspectorLive) => value.name],
  ["tag", "Tag", (value: InspectorLive) => value.tag],
  ["id", "ID", (value: InspectorLive) => value.id],
  ["classes", "Classes", (value: InspectorLive) => value.classes],
  ["size", "Width × height", (value: InspectorLive) => `${Math.round(value.width)} × ${Math.round(value.height)} px`],
  ["position", "Position", (value: InspectorLive) => `${Math.round(value.pageX)}px, ${Math.round(value.pageY)}px`],
  ["text", "Text", (value: InspectorLive) => value.text],
  ["text-color", "Text colour", (value: InspectorLive) => value.textColor],
  ["background-color", "Background colour", (value: InspectorLive) => value.backgroundColor],
  ["font-family", "Font family", (value: InspectorLive) => value.fontFamily],
  ["font-size", "Font size", (value: InspectorLive) => value.fontSize],
  ["font-weight", "Font weight", (value: InspectorLive) => value.fontWeight],
] as const;

function shared(values: readonly InspectorLive[], read: (value: InspectorLive) => string) {
  const first = read(values[0]);
  return values.every(value => read(value) === first) ? first : "Mixed";
}

function LiveSection({ snapshot }: { snapshot: InspectorSnapshot }) {
  return <section className="inspector-section" data-testid="inspector-live">
    <h3>Live</h3>
    {snapshot.live === null ? <p data-testid="live-loading">Loading…</p> : <dl>
      {fields.map(([id, label, read]) => <div key={id} className="inspector-field">
        <dt>{label}</dt><dd data-testid={`live-${id}`}>{shared(snapshot.live!, read)}</dd>
      </div>)}
    </dl>}
  </section>;
}

function DetailsBody({ snapshot }: { snapshot: InspectorSnapshot }) {
  if (snapshot.details.kind === "loading") return <p data-testid="details-loading">Loading…</p>;
  if (snapshot.details.kind === "none") return <p data-testid="details-none">No details</p>;
  if (snapshot.details.kind === "not-found") return <p data-testid="details-not-found">No details for this element</p>;
  if (snapshot.details.kind !== "found") return null;
  const details = snapshot.details.details;
  return <dl>
    <div className="inspector-field"><dt>Component</dt><dd data-testid="details-component">{details.component}</dd></div>
    <div className="inspector-field"><dt>Description</dt><dd data-testid="details-description">{details.description}</dd></div>
    <div className="inspector-field"><dt>Status</dt><dd data-testid="details-status">{details.status}</dd></div>
    <div className="inspector-field"><dt>Owner</dt><dd data-testid="details-owner">{details.owner}</dd></div>
  </dl>;
}

function DetailsSection({ store, snapshot }: { store: InspectorStore; snapshot: InspectorSnapshot }) {
  if (snapshot.details.kind === "hidden") return null;
  const content = <DetailsBody snapshot={snapshot} />;
  return <section className="inspector-section" data-testid="inspector-details">
    <h3>Details</h3>
    {snapshot.detailsRegion
      ? <RegionBoundary key={`${snapshot.revision}-${snapshot.detailsRegion.getSnapshot().generation}`} region={snapshot.detailsRegion} onRetry={store.retryDetails} testId="details">{content}</RegionBoundary>
      : content}
  </section>;
}

function InspectorContent({ store, snapshot }: { store: InspectorStore; snapshot: InspectorSnapshot }) {
  if (snapshot.renderError) throw snapshot.renderError;
  if (snapshot.missing) return <p data-testid="inspector-missing">This element no longer exists</p>;
  if (!snapshot.count) return null;
  return <>
    {snapshot.count > 1 ? <h2 data-testid="inspector-count">{snapshot.count} elements</h2> : null}
    <LiveSection snapshot={snapshot} />
    <DetailsSection store={store} snapshot={snapshot} />
  </>;
}

export function Inspector({ store }: { store: InspectorStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <aside className="inspector" data-testid="inspector">
    <h2>Inspector</h2>
    {snapshot.region
      ? <RegionBoundary key={snapshot.revision} region={snapshot.region} onRetry={store.clearRenderFailure} testId="inspector">
        <InspectorContent store={store} snapshot={snapshot} />
      </RegionBoundary>
      : null}
  </aside>;
}
