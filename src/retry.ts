/** Virtual-time backoff schedule after job failures. */
export class RetryPolicy {
  constructor(private readonly backoff: number[]) {}

  /** Buggy: ignores schedule and always retries immediately. */
  delayForAttempt(_attempts: number): number {
    return 0;
  }
}
