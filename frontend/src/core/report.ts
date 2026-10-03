// Preserves the kit reporter signature and call count; fail() exclusively owns routing and deduplication.
import { devLog } from "./dev-log";
import { appendLog } from "./log";

export type Region = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";

export interface ReportContext {
  region: Region;
  screenId: string | null;
  elementKey?: string;
}

let count = 0;

/** Records an already-deduplicated failure; fail() is the only permitted caller. */
export function report(error: unknown, context: ReportContext): void {
  count += 1;
  appendLog("report", error, context);
  devLog(`[report #${count}]`, { error, ...context });
}

/** Exposes the lifetime report count for the dev log and core verification, without resetting dedupe. */
export function getReportCount(): number { return count; }
