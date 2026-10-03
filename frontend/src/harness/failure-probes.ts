// Owns temporary M2 render-injection state for browser verification; product render failures and feature state are not simulated here.
import { registerDevTrigger } from "../core/dev-registry";
import { attributeError } from "../core/fail";
import type { FailureRegion } from "../stores/failure-region";
import { scopedFrame, scopedTimeout } from "../core/schedule";
import { runAttempt } from "../core/attempt";

/** Creates a dev-only render probe with stable external-store snapshots and an explicit recovery action. */
export function createRenderProbe() {
  let error: Error | null = null;
  const listeners = new Set<() => void>();
  /** Replaces injected state and notifies the temporary probe view. */
  function set(value: Error | null): void { error = value; for (const listener of listeners) listener(); }
  /** Reads the injected error without creating a new failure during render. */
  function getSnapshot(): Error | null { return error; }
  /** Subscribes one temporary render-probe view. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Removes a probe reader when the view is gone. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }
  /** Removes the injected fault so a regional Retry can render normally. */
  function clear(): void { set(null); }
  /** Injects a fresh error object for a new failure occurrence. */
  function inject(): void { set(new Error("M2 render probe")); }
  return { getSnapshot, subscribe, clear, inject };
}
export type RenderProbe = ReturnType<typeof createRenderProbe>;

/** Registers only failure-core probes; API, layers and product failure triggers arrive in their feature milestones. */
export function registerCoreProbes(board: FailureRegion, preview: FailureRegion, render: RenderProbe): void {
  /** Attributes a synchronous handler throw to the board. */
  function boardHandler(): void { throw new Error("M2 board handler probe"); }
  /** Attributes a synchronous handler throw to the preview, leaving the board's controls intact. */
  function previewHandler(): void { throw new Error("M2 preview handler probe"); }
  /** Throws from a guarded timeout callback rather than the button entry point. */
  function timer(): void { scopedTimeout(board.target, boardHandler, 0); }
  /** Throws from a guarded drawing callback rather than the button entry point. */
  function frame(): void { scopedFrame(board.target, boardHandler); }
  /** Lets the host-global rejection hook exercise its fallback attribution path. */
  function globalRejection(): void {
    const error = new Error("M2 global rejection probe");
    attributeError(error, board.target);
    void Promise.reject(error);
  }
  /** Resolves ignored work after cancelling its attempt, proving that cancellation has no report or apply. */
  function cancelled(): void {
    /** Supplies a delayed response even though the request's abort signal will be cancelled. */
    function load(): Promise<number> { return new Promise(resolveResponse); }
    /** Simulates response arrival after cancellation without depending on a network failure mode. */
    function resolveResponse(resolve: (value: number) => void): void { setTimeout(resolve, 50, 1); }
    /** Makes an erroneous stale application visible if cancellation protection ever regresses. */
    function apply(): void { throw new Error("Cancelled response was applied"); }
    runAttempt(board.target, load, apply).cancel();
  }
  /** Reads the current retry generation when a probe is entered. */
  function boardTarget() { return board.target; }
  /** Reads the preview's current generation when its probe is entered. */
  function previewTarget() { return preview.target; }
  registerDevTrigger({ id: "board-handler", label: "M2 board handler", target: boardTarget, run: boardHandler });
  registerDevTrigger({ id: "preview-handler", label: "M2 preview handler", target: previewTarget, run: previewHandler });
  registerDevTrigger({ id: "render", label: "M2 board render", target: boardTarget, run: render.inject });
  registerDevTrigger({ id: "timer", label: "M2 timer", target: boardTarget, run: timer });
  registerDevTrigger({ id: "frame", label: "M2 rAF", target: boardTarget, run: frame });
  registerDevTrigger({ id: "global", label: "M2 global rejection", target: boardTarget, run: globalRejection });
  registerDevTrigger({ id: "cancel", label: "M2 cancel attempt", target: boardTarget, run: cancelled });
}
