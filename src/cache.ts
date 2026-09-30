/** Simple sorted string KV (base mode). */
export class LocalCache {
  private readonly data = new Map<string, string>();

  put(key: string, value: string): void {
    this.data.set(key, value);
  }

  get(key: string): string | undefined {
    return this.data.get(key);
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  keys(): string[] {
    return [...this.data.keys()].sort();
  }

  size(): number {
    return this.data.size;
  }
}
