export interface Entry<V> {
  value: V;
  deadline: number;
  touchedAt: number;
  pinned: boolean;
}

/**
 * Registered entries plus their global touch order.
 * Map insertion order doubles as the touch order (oldest -> newest):
 * touching a key deletes and re-inserts it, moving it to the newest end.
 */
export class EntryStore<V> {
  readonly #entries = new Map<string, Entry<V>>();

  get size(): number {
    return this.#entries.size;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  get(key: string): Entry<V> | undefined {
    return this.#entries.get(key);
  }

  /** Insert a new key at the newest end of the touch order. */
  insert(key: string, entry: Entry<V>): void {
    this.#entries.set(key, entry);
  }

  /** Move an existing key to the newest end of the touch order. */
  touch(key: string, touchedAt: number): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    this.#entries.delete(key);
    entry.touchedAt = touchedAt;
    this.#entries.set(key, entry);
  }

  delete(key: string): boolean {
    return this.#entries.delete(key);
  }

  /** Registered keys in touch order, oldest first. */
  keysOldestFirst(): string[] {
    return [...this.#entries.keys()];
  }

  /** Oldest registered key that is not pinned, or undefined. */
  oldestUnpinned(): string | undefined {
    for (const [key, entry] of this.#entries) {
      if (!entry.pinned) return key;
    }
    return undefined;
  }
}
