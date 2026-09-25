/** Per-resource monotonic fencing tokens. */
export class FencingTokenRegistry {
  private readonly counters = new Map<string, number>();

  nextToken(resourceId: string): number {
    const next = (this.counters.get(resourceId) ?? 0) + 1;
    this.counters.set(resourceId, next);
    return next;
  }

  maxIssued(resourceId: string): number {
    return this.counters.get(resourceId) ?? 0;
  }
}
