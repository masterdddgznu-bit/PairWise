/** Exact string counter map (base mode). */
export class ExactCounter {
  private readonly map = new Map<string, number>();

  inc(key: string, n = 1): void {
    this.map.set(key, (this.map.get(key) ?? 0) + n);
  }

  get(key: string): number {
    return this.map.get(key) ?? 0;
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  size(): number {
    return this.map.size;
  }

  total(): number {
    let sum = 0;
    for (const v of this.map.values()) sum += v;
    return sum;
  }
}
