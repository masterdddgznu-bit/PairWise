export interface Entry<V> {
  value: V;
  deadline: number;
  touchedAt: number;
  pinned: boolean;
}

/**
 * Insertion-ordered store of entries. Iteration order is the global touch
 * order, oldest to newest. Touching a key moves it to the newest end.
 */
export class TouchOrder<V> {
  private readonly entries = new Map<string, Entry<V>>();

  get size(): number {
    return this.entries.size;
  }

  get(key: string): Entry<V> | undefined {
    return this.entries.get(key);
  }

  insert(key: string, entry: Entry<V>): void {
    this.entries.set(key, entry);
  }

  touch(key: string, entry: Entry<V>, now: number): void {
    entry.touchedAt = now;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Keys of expired entries, oldest to newest. */
  expiredKeys(now: number): string[] {
    const out: string[] = [];
    for (const [key, entry] of this.entries) {
      if (now >= entry.deadline) {
        out.push(key);
      }
    }
    return out;
  }

  /** Oldest registered key that is not pinned, or undefined. */
  oldestUnpinnedKey(): string | undefined {
    for (const [key, entry] of this.entries) {
      if (!entry.pinned) {
        return key;
      }
    }
    return undefined;
  }
}
