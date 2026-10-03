// Schedules cancellable timer/rAF entry points; guard supplies attribution and callers own repeating work.
import type { FailureTarget } from "./fail";
import { guard } from "./guard";

/** Runs one guarded timeout and removes it when its scope dies or the caller replaces it. */
export function scopedTimeout(target: FailureTarget, work: () => unknown, delay: number): () => void {
  if (!target.ctx.scope.alive) return inactive;
  const callback = guard(target, work);
  const timer = setTimeout(fire, delay);
  target.ctx.scope.signal.addEventListener("abort", cancel, { once: true });
  /** Cancels native scheduling without invoking dead application callbacks. */
  function cancel(): void {
    clearTimeout(timer);
    target.ctx.scope.signal.removeEventListener("abort", cancel);
  }
  /** Removes the abort subscription before entering the guarded timer callback. */
  function fire(): void { cancel(); callback(); }
  return cancel;
}

/** Runs one guarded animation frame and cancels it when its region is gone. */
export function scopedFrame(target: FailureTarget, work: (time: number) => unknown): () => void {
  if (!target.ctx.scope.alive) return inactive;
  const callback = guard(target, work);
  const frame = requestAnimationFrame(fire);
  target.ctx.scope.signal.addEventListener("abort", cancel, { once: true });
  /** Cancels native frame scheduling without calling application code. */
  function cancel(): void {
    cancelAnimationFrame(frame);
    target.ctx.scope.signal.removeEventListener("abort", cancel);
  }
  /** Detaches cleanup before entering the guarded drawing callback. */
  function fire(time: number): void { cancel(); callback(time); }
  return cancel;
}

/** Supplies an inert cancellation handle when no live work was scheduled. */
function inactive(): void {}
