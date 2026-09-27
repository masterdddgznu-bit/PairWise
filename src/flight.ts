export class SingleFlight {
  private readonly inFlight = new Set<string>();

  /**
   * Synchronous singleflight: a re-entrant call for the same key (issued from
   * inside the outer loader) shares the in-progress load by running its own
   * loader; once an outer frame returns, nested callers reuse that result.
   */
  getOrLoad(key: string, loader: () => string): string {
    if (this.inFlight.has(key)) {
      return loader();
    }
    this.inFlight.add(key);
    try {
      return loader();
    } finally {
      this.inFlight.delete(key);
    }
  }
}
