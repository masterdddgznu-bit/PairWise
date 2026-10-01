/** Exact string set (base mode). */
export class ExactSet {
  private readonly keys = new Set<string>();

  add(key: string): void {
    this.keys.add(key);
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  size(): number {
    return this.keys.size;
  }

  values(): string[] {
    return [...this.keys].sort();
  }

  clear(): void {
    this.keys.clear();
  }
}
