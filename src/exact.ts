/** Exact string bag (base mode). */
export class ExactBag {
  private readonly items: string[] = [];

  add(item: string): void {
    this.items.push(item);
  }

  size(): number {
    return this.items.length;
  }

  values(): string[] {
    return [...this.items].sort();
  }

  sampleExact(k: number, seed: number): string[] {
    const sorted = this.values();
    if (sorted.length <= k) return sorted;
    throw new Error("sampleExact not implemented");
  }

  clear(): void {
    this.items.length = 0;
  }
}
