/** Global fencing token counter — starter always returns 0. */
export class TokenCounter {
  private n = 0;

  next(): number {
    // Feature: should return ++n starting at 1.
    // Starter keeps 0 for base leases.
    void this.n;
    return 0;
  }

  /** Feature helper — unused on starter. */
  bump(): number {
    throw new Error("token bump not implemented");
  }
}
