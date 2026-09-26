/** Virtual-time backoff schedule after job failures. */
export class RetryPolicy {
  constructor(private readonly backoff: number[]) {}

  /**
   * Backoff for the given 1-based failed attempt count:
   * attempts 1 -> backoff[0], attempts 2 -> backoff[1], then the last entry.
   */
  delayForAttempt(attempts: number): number {
    if (this.backoff.length === 0) return 0;
    const idx = Math.min(Math.max(attempts, 1), this.backoff.length) - 1;
    return this.backoff[idx];
  }
}
