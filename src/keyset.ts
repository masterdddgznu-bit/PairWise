/** Simple sorted string set (base mode). */
export class KeySet {
  private readonly keys = new Set<string>();

  add(key: string): void {
    this.keys.add(key);
  }

  remove(key: string): boolean {
    return this.keys.delete(key);
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  values(): string[] {
    return [...this.keys].sort();
  }

  size(): number {
    return this.keys.size;
  }
}
