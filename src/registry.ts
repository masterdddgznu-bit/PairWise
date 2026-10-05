export interface Entry {
  id: string;
  weight: number;
  priority: number;
  ts: number;
}

/**
 * Window registration table. Iteration order is first-add order;
 * re-adding a removed id appends it to the tail.
 */
export class WindowRegistry {
  private entries = new Map<string, Entry>();

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): Entry | undefined {
    return this.entries.get(id);
  }

  add(entry: Entry): void {
    this.entries.delete(entry.id);
    this.entries.set(entry.id, entry);
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  values(): Entry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}
