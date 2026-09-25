/** Virtual-time backoff schedule for failed or reclaimed deliveries. */
export class RetryPolicy {
  constructor(private readonly backoff: number[]) {}

  delayForAttempt(attempts: number): number {
    if (this.backoff.length === 0) return 0;
    const idx = Math.min(Math.max(attempts, 0), this.backoff.length - 1);
    return this.backoff[idx]!;
  }
}
