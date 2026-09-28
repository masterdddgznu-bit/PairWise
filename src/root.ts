/** Mutable map root for HEAD — starter has no version sharing. */
export class MapRoot {
  private readonly map = new Map<string, string>();

  put(key: string, value: string): void {
    this.map.set(key, value);
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  size(): number {
    return this.map.size;
  }

  cloneData(): Map<string, string> {
    return new Map(this.map);
  }

  replaceWith(data: Map<string, string>): void {
    this.map.clear();
    for (const [k, v] of data) this.map.set(k, v);
  }
}
