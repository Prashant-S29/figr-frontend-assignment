// Owns failure attribution, identity deduplication and the sole report() call; region stores own visible state.
import { appendLog, errorMessage } from "./log";
import { report, type Region, type ReportContext } from "./report";
import type { Scope } from "./scope";

export interface Failure {
  readonly id: number;
  readonly message: string;
  readonly context: Readonly<ReportContext>;
}
export interface FailureContext {
  screenId: string | null;
  elementKey?: string;
  scope: Scope;
  /** Region-owned generation token and publication action; child attempts reuse this exact callback. */
  publish(failure: Failure): void;
}
export interface FailureTarget { region: Region; ctx: FailureContext }

interface Occurrence { target: FailureTarget; failure?: Failure }
const occurrences = new WeakMap<object, Occurrence>();
let sequence = 0;

/** Recognizes identities that can be attributed and deduplicated without retaining them forever. */
function identity(error: unknown): error is object {
  return (typeof error === "object" && error !== null) || typeof error === "function";
}

/** Binds an occurrence before global delivery; only explicit live work in a new retry generation can reuse its identity. */
export function attributeError(error: object, target: FailureTarget): void {
  const previous = occurrences.get(error);
  // Publisher identity survives child-scope completion and changes only when the region starts a new generation.
  if (!previous || (!previous.target.ctx.scope.alive && target.ctx.scope.alive && previous.target.ctx.publish !== target.ctx.publish)) {
    occurrences.set(error, { target });
  }
}

/** Recovers the original scoped owner for global catches, including cancelled operations. */
export function failureOwner(error: unknown): FailureTarget | undefined {
  return identity(error) ? occurrences.get(error)?.target : undefined;
}

/** Reports and publishes a live failure exactly once; cancelled/stale work is attributed but otherwise silent. */
export function fail(region: Region, error: unknown, ctx: FailureContext): Failure | null {
  const key = identity(error) ? error : new Error(String(error));
  attributeError(key, { region, ctx });
  const occurrence = occurrences.get(key)!;
  const owner = occurrence.target;
  if (!ctx.scope.alive || !owner.ctx.scope.alive) return null;
  if (occurrence.failure) return occurrence.failure;
  const context: ReportContext = { region: owner.region, screenId: owner.ctx.screenId };
  if (owner.ctx.elementKey !== undefined) context.elementKey = owner.ctx.elementKey;
  const failure: Failure = { id: ++sequence, message: errorMessage(key), context };
  occurrence.failure = failure;
  appendLog("failure", key, context);
  report(key, context);
  owner.ctx.publish(failure);
  return failure;
}
