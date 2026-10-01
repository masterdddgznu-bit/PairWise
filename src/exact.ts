/** Exact string multiset (base mode). */
export class ExactMultiSet {
  private readonly counts = new Map<string, number>();

  add(key: string, n = 1): void {
    const next = (this.counts.get(key) ?? 0) + n;
    if (next <= 0) this.counts.delete(key);
    else this.counts.set(key, next);
  }

  remove(key: string, n = 1): void {
    const next = Math.max(0, (this.counts.get(key) ?? 0) - n);
    if (next === 0) this.counts.delete(key);
    else this.counts.set(key, next);
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

  clear(): void {
    this.counts.clear();
  }

  keys(): string[] {
    return [...this.counts.keys()].sort();
  }
}
