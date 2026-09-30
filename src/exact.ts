/** Exact string frequency counter (base mode). */
export class ExactCounter {
  private readonly counts = new Map<string, number>();

  add(key: string, delta = 1): void {
    const next = (this.counts.get(key) ?? 0) + delta;
    if (next === 0) this.counts.delete(key);
    else this.counts.set(key, next);
  }

  get(key: string): number {
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
