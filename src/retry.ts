/** Virtual-time backoff schedule after job failures. */
export class RetryPolicy {
  constructor(private readonly backoff: number[]) {}

  /** Delay after the `attempts`-th failure: backoff[attempts-1], clamped to last. */
  delayForAttempt(attempts: number): number {
    if (this.backoff.length === 0) return 0;
    const idx = Math.min(Math.max(attempts - 1, 0), this.backoff.length - 1);
    return this.backoff[idx];
  }
}
