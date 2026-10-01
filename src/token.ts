/** Monotonic fencing token per tenant+resource pair. */
export class TokenGenerator {
  private counters = new Map<string, number>();

  static key(tenant: string, resource: string): string {
    return `${tenant}\0${resource}`;
  }

  next(tenant: string, resource: string): number {
    const k = TokenGenerator.key(tenant, resource);
    const n = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, n);
    return n;
  }

  current(tenant: string, resource: string): number {
    return this.counters.get(TokenGenerator.key(tenant, resource)) ?? 0;
  }

  ensureAtLeast(tenant: string, resource: string, minToken: number): void {
    const k = TokenGenerator.key(tenant, resource);
    const cur = this.counters.get(k) ?? 0;
    if (cur < minToken) {
      this.counters.set(k, minToken);
    }
  }

  exportCounters(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[k] = v;
    return out;
  }

  importCounters(data: Record<string, number>): void {
    for (const [k, v] of Object.entries(data)) {
      const cur = this.counters.get(k) ?? 0;
      if (v > cur) this.counters.set(k, v);
    }
  }

  reset(): void {
    this.counters.clear();
  }
}
