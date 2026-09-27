/** Global fencing token counter — monotonically increasing from 1. */
export class TokenCounter {
  private n = 0;

  next(): number {
    this.n += 1;
    return this.n;
  }

  /** Alias for next() — issues a fresh token. */
  bump(): number {
    return this.next();
  }
}
