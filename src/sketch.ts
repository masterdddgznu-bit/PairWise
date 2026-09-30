import { SSError } from "./errors.js";
import { findMinEntryIndex } from "./slots.js";
import type { SSEntry, SSStats } from "./types.js";

/** Deterministic Space-Saving heavy-hitters sketch (Metwally). */
export class SpaceSaving {
  private readonly capacity: number;
  private entries: SSEntry[] = [];
  private offered = 0;
  private frozen = false;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new SSError("capacity must be an integer >= 1");
    }
    this.capacity = capacity;
  }

  offer(key: string, count = 1): void {
    if (this.frozen) {
      throw new SSError("sketch is frozen");
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new SSError("count must be a positive integer");
    }
    this.offered += count;
    const existing = this.entries.find((e) => e.key === key);
    if (existing) {
      existing.count += count;
      return;
    }
    if (this.entries.length < this.capacity) {
      this.entries.push({ key, count, error: 0 });
      return;
    }
    const idx = findMinEntryIndex(this.entries);
    const min = this.entries[idx];
    this.entries[idx] = { key, count: min.count + count, error: min.count };
  }

  estimate(key: string): number {
    return this.entries.find((e) => e.key === key)?.count ?? 0;
  }

  guarantee(key: string): number {
    const e = this.entries.find((en) => en.key === key);
    return e ? Math.max(0, e.count - e.error) : 0;
  }

  topK(k: number): SSEntry[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new SSError("k must be an integer >= 1");
    }
    return this.entries
      .map((e) => ({ ...e }))
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, k);
  }

  merge(other: SpaceSaving): void {
    if (this.frozen) {
      throw new SSError("sketch is frozen");
    }
    if (other.capacity !== this.capacity) {
      throw new SSError("capacity mismatch");
    }
    const keys = new Set<string>();
    for (const e of this.entries) keys.add(e.key);
    for (const e of other.entries) keys.add(e.key);
    const merged = new SpaceSaving(this.capacity);
    for (const key of [...keys].sort()) {
      merged.offer(key, Math.max(this.estimate(key), other.estimate(key)));
    }
    this.entries = merged.entries;
    this.offered = merged.offered;
  }

  exportEntries(): SSEntry[] {
    return this.entries
      .map((e) => ({ ...e }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  static fromEntries(capacity: number, entries: SSEntry[]): SpaceSaving {
    const ss = new SpaceSaving(capacity);
    for (const e of entries) {
      ss.entries.push({ key: e.key, count: e.count, error: e.error });
      ss.offered += e.count;
    }
    return ss;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SSStats {
    return {
      capacity: this.capacity,
      size: this.entries.length,
      totalOffered: this.offered,
      frozen: this.frozen,
    };
  }

  totalOffered(): number {
    return this.offered;
  }
}
