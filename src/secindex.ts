/** Value -> keys secondary index. */
export class SecondaryIndex {
  private readonly byValue = new Map<string, Set<string>>();

  add(key: string, value: string): void {
    let keys = this.byValue.get(value);
    if (keys === undefined) {
      keys = new Set();
      this.byValue.set(value, keys);
    }
    keys.add(key);
  }

  remove(key: string, value: string): void {
    const keys = this.byValue.get(value);
    if (keys === undefined) return;
    keys.delete(key);
    if (keys.size === 0) this.byValue.delete(value);
  }

  find(value: string): string[] {
    const keys = this.byValue.get(value);
    if (keys === undefined) return [];
    return [...keys].sort();
  }

  clear(): void {
    this.byValue.clear();
  }

  rebuild(entries: [string, string][]): void {
    this.clear();
    for (const [key, value] of entries) this.add(key, value);
  }
}
