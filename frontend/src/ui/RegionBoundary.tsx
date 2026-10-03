// Isolates regional render errors and reads external failure snapshots; React does not own shared error or retry state.
import { Component, useSyncExternalStore, type ReactNode } from "react";
import { fail, type FailureTarget } from "../core/fail";
import { guard } from "../core/guard";
import { errorMessage } from "../core/log";
import type { FailureRegion } from "../stores/failure-region";
import { RegionError } from "./RegionError";

interface RenderProps { target: FailureTarget; children: ReactNode; retry: () => void; testId: string }

export class RegionRenderBoundary extends Component<RenderProps, { caught: boolean; error: unknown }> {
  state = { caught: false, error: undefined as unknown };

  static getDerivedStateFromError(error: unknown) { return { caught: true, error }; }

  componentDidCatch(error: unknown): void { fail(this.props.target.region, error, this.props.target.ctx); }

  render() {
    return this.state.caught
      ? <RegionError message={errorMessage(this.state.error)} retry={this.props.retry} testId={this.props.testId} />
      : this.props.children;
  }
}

export function RegionBoundary({ region, children, onRetry, testId }: { region: FailureRegion; children: ReactNode; onRetry?: () => void; testId: string }) {
  const snapshot = useSyncExternalStore(region.subscribe, region.getSnapshot);
  const target = region.target;
  const retry = guard(target, () => {
    region.retry();
    if (onRetry) guard(region.target, onRetry)();
  });
  if (snapshot.failure) return <RegionError message={snapshot.failure.message} retry={retry} testId={testId} />;
  return <RegionRenderBoundary key={snapshot.generation} target={target} retry={retry} testId={testId}>{children}</RegionRenderBoundary>;
}

export function routeCaughtRender(error: unknown, info: { errorBoundary?: object | null }, fallback: FailureTarget): void {
  const target = info.errorBoundary instanceof RegionRenderBoundary ? info.errorBoundary.props.target : fallback;
  fail(target.region, error, target.ctx);
}
