// Owns the dev-menu trigger registry, not feature failures or region state; feature milestones register their own actions.
import type { FailureTarget } from "./fail";

export interface DevTrigger {
  id: string;
  label: string;
  target(): FailureTarget;
  run(): unknown;
}
const triggers = new Map<string, DevTrigger>();
const listeners = new Set<() => void>();
let snapshot: readonly DevTrigger[] = [];

/** Replaces the registry snapshot before notifying menu readers. */
function notify(): void {
  snapshot = [...triggers.values()];
  for (const listener of listeners) listener();
}

/** Registers an on-demand action and returns ownership-safe removal for feature teardown. */
export function registerDevTrigger(trigger: DevTrigger): () => void {
  triggers.set(trigger.id, trigger);
  notify();
  /** Prevents an old registration from removing a newer action with the same stable id. */
  return function unregister(): void {
    if (triggers.get(trigger.id) !== trigger) return;
    triggers.delete(trigger.id);
    notify();
  };
}

/** Reads stable menu entries without executing any registered feature action. */
export function getTriggerSnapshot(): readonly DevTrigger[] { return snapshot; }

/** Subscribes the development view without granting it registry mutation ownership. */
export function subscribeTriggers(listener: () => void): () => void {
  listeners.add(listener);
  /** Removes the menu reader when the development view is gone. */
  return function unsubscribe(): void { listeners.delete(listener); };
}
