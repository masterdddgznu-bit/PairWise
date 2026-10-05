export interface WindowEntry {
  id: string;
  weight: number;
  priority: number;
  ts: number;
}

/**
 * Window registry. Iteration order is first-add order: re-adding an id
 * after removal appends it at the tail.
 */
export class WindowRegistry {
  private readonly entries = new Map<string, WindowEntry>();

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): WindowEntry | undefined {
    return this.entries.get(id);
  }

  add(entry: WindowEntry): void {
    this.entries.delete(entry.id);
    this.entries.set(entry.id, entry);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  size(): number {
    return this.entries.size;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  values(): WindowEntry[] {
    return [...this.entries.values()];
  }

  inWindow(now: number, windowMs: number): WindowEntry[] {
    return this.values().filter((entry) => now - entry.ts < windowMs);
  }

  /** Remove entries slid out of the window; returns purged ids in add order. */
  purgeStale(now: number, windowMs: number): string[] {
    const purged: string[] = [];
    for (const entry of this.entries.values()) {
      if (now - entry.ts >= windowMs) {
        this.entries.delete(entry.id);
        purged.push(entry.id);
      }
    }
    return purged;
  }
}
