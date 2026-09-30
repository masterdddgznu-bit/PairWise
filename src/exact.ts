/** Exact string set for cardinality ground truth (base mode). */
export class ExactSet {
  private readonly keys = new Set<string>();

  add(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  remove(key: string): boolean {
    return this.keys.delete(key);
  }

  values(): string[] {
    return [...this.keys].sort();
  }

  size(): number {
    return this.keys.size;
  }
}
