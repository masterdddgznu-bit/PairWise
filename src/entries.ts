import type { Dot, Entry } from "./types.js";
import { dotWins } from "./dot.js";

export class EntryStore {
  private readonly entries = new Map<string, Entry>();

  put(key: string, value: string, dot: Dot): void {
    this.entries.set(key, { key, value, dot });
  }

  tombstone(key: string, dot: Dot): boolean {
    const existing = this.entries.get(key);
    if (existing === undefined || existing.value === null) return false;
    this.entries.set(key, { key, value: null, dot });
    return true;
  }

  getValue(key: string): string | undefined {
    return this.entries.get(key)?.value ?? undefined;
  }

  getEntry(key: string): Entry | undefined {
    return this.entries.get(key);
  }

  keys(): string[] {
    return this.all()
      .filter((e) => e.value !== null)
      .map((e) => e.key)
      .sort();
  }

  size(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.value !== null) count++;
    }
    return count;
  }

  all(): Entry[] {
    return [...this.entries.values()];
  }

  applyLww(entry: Entry): void {
    const existing = this.entries.get(entry.key);
    if (existing === undefined || dotWins(entry.dot, existing.dot)) {
      this.entries.set(entry.key, entry);
    }
  }

  removeTombstones(pred: (e: Entry) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.value === null && pred(entry)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
