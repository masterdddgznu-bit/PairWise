export class SingleFlight {
  private readonly inflight = new Set<string>();

  isInflight(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Marks `key` as loading while `fn` runs. Because loading is synchronous,
   * the only way a second request for the same key can occur is re-entrance
   * inside `fn`; the marker is idempotent so the nested call shares this load
   * (it is the nested call that publishes the single final result).
   */
  run<T>(key: string, fn: () => T): T {
    this.inflight.add(key);
    try {
      return fn();
    } finally {
      this.inflight.delete(key);
    }
  }
}
