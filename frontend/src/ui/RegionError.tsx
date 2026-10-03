// Presents one region's plain-text failure and Retry action; failure state and recovery remain owned by the region store.
export function RegionError({ message, retry, testId }: { message: string; retry: () => void; testId: string }) {
  return (
    <div role="alert" className="region-error" data-testid={`${testId}-error`}>
      <p>{message}</p>
      <button type="button" data-testid={`${testId}-retry`} onClick={retry}>Retry</button>
    </div>
  );
}
