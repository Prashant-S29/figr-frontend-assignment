// Reads bounded diagnostics and registered dev actions; features own triggers and the menu is absent in normal production.
import { useSyncExternalStore } from "react";
import { getTriggerSnapshot, subscribeTriggers, type DevTrigger } from "../core/dev-registry";
import { guard } from "../core/guard";
import { getLogSnapshot, subscribeLog } from "../core/log";
import { getReportCount } from "../core/report";

export function DevMenu({ visible }: { visible: boolean }) {
  return visible ? <VisibleDevMenu /> : null;
}

function Trigger({ trigger }: { trigger: DevTrigger }) {
  return <button type="button" data-testid={`dev-${trigger.id}`} onClick={() => guard(trigger.target(), trigger.run)()}>{trigger.label}</button>;
}

function VisibleDevMenu() {
  const triggers = useSyncExternalStore(subscribeTriggers, getTriggerSnapshot);
  const entries = useSyncExternalStore(subscribeLog, getLogSnapshot);
  return (
    <details className="dev-menu" data-testid="dev-menu">
      <summary data-testid="dev-toggle">Development failures</summary>
      <p>Reports: <output data-testid="report-count">{getReportCount()}</output> · Latest {entries.length}/100 log entries</p>
      <div>{triggers.map(trigger => <Trigger key={trigger.id} trigger={trigger} />)}</div>
      <ol data-testid="failure-log">
        {entries.map(entry => <li key={entry.id} data-testid={`log-${entry.kind}`}>
          {entry.kind}: {entry.context.region} / {entry.context.screenId ?? "board"}{entry.context.elementKey ? ` / ${entry.context.elementKey}` : ""} — {entry.message}
        </li>)}
      </ol>
    </details>
  );
}
