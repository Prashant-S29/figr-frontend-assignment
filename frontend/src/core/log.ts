// Owns a bounded diagnostic history and subscriptions; it does not report, deduplicate or alter region state.
import type { ReportContext } from "./report";

export interface LogEntry {
  readonly id: number;
  readonly kind: "failure" | "report";
  readonly message: string;
  readonly context: Readonly<ReportContext>;
}

const capacity = 100;
const buffer: LogEntry[] = [];
const listeners = new Set<() => void>();
let cursor = 0;
let sequence = 0;
let snapshot: readonly LogEntry[] = [];

/** Converts thrown values to text without treating their contents as markup. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Appends one diagnostic occurrence while retaining only the latest hundred ordered entries. */
export function appendLog(kind: LogEntry["kind"], error: unknown, context: ReportContext): void {
  buffer[cursor] = { id: ++sequence, kind, message: errorMessage(error), context: { ...context } };
  cursor = (cursor + 1) % capacity;
  snapshot = buffer.length < capacity ? buffer.slice() : [...buffer.slice(cursor), ...buffer.slice(0, cursor)];
  for (const listener of listeners) listener();
}

/** Returns the stable external-store snapshot until the next diagnostic entry is appended. */
export function getLogSnapshot(): readonly LogEntry[] { return snapshot; }

/** Subscribes a reader without giving it permission to mutate retained diagnostics. */
export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  /** Removes only this reader when its view is gone. */
  return function unsubscribe(): void { listeners.delete(listener); };
}
