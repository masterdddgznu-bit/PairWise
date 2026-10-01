/** Exact string frequency counter (base mode). */
export class ExactFreq {
  private readonly counts = new Map<string, number>();

  add(key: string, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }

  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  size(): number {
    return this.counts.size;
  }

  total(): number {
    let sum = 0;
    for (const v of this.counts.values()) sum += v;
    return sum;
  }

  topK(k: number): { key: string; count: number }[] {
    return [...this.counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, k);
  }

  clear(): void {
    this.counts.clear();
  }

  keys(): string[] {
    return [...this.counts.keys()].sort();
  }
}
