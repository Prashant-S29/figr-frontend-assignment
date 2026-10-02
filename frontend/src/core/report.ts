// Ports the kit reporter and its context unchanged; failure routing and deduplication belong to fail() in M2.
import { devLog } from "./dev-log";

export type Region = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";

export interface ReportContext {
  region: Region;
  screenId: string | null;
  elementKey?: string;
}

let count = 0;

/** Records a routed failure; fail() will be the sole caller once the failure core is built. */
export function report(error: unknown, context: ReportContext): void {
  count += 1;
  devLog(`[report #${count}]`, { error, ...context });
}
