// Owns one cancellable async attempt and latest-scope publication; region actions decide when to replace attempts.
import { fail, type FailureTarget } from "./fail";
import { createScope, type Scope } from "./scope";

export interface Attempt {
  scope: Scope;
  settled: Promise<void>;
  cancel(): void;
}

/** Runs work under a child scope, applying only live results and containing both load and apply failures. */
export function runAttempt<T>(target: FailureTarget, load: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void): Attempt {
  const scope = createScope(target.ctx.scope);
  const scoped = { ...target.ctx, scope };
  /** Handles response arrival under the same scope that owned the request. */
  async function run(): Promise<void> {
    try {
      if (!scope.alive) return;
      const value = await load(scope.signal);
      if (scope.alive) apply(value);
    } catch (error) { fail(target.region, error, scoped); }
    finally { scope.dispose(); }
  }
  return { scope, settled: run(), cancel: scope.dispose };
}
