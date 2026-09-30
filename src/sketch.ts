import { SSError } from "./errors.js";
import { findMinEntryIndex } from "./slots.js";
import type { SSEntry, SSStats } from "./types.js";

/** Deterministic Space-Saving heavy-hitters sketch (Metwally et al.). */
export class SpaceSaving {
  private readonly capacity: number;
  private readonly entries = new Map<string, SSEntry>();
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
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.count += count;
      return;
    }
    if (this.entries.size < this.capacity) {
      this.entries.set(key, { key, count, error: 0 });
      return;
    }
    const all = [...this.entries.values()];
    const minIndex = findMinEntryIndex(all);
    const victim = all[minIndex];
    this.entries.delete(victim.key);
    this.entries.set(key, { key, count: victim.count + count, error: victim.count });
  }

  estimate(key: string): number {
    return this.entries.get(key)?.count ?? 0;
  }

  guarantee(key: string): number {
    const entry = this.entries.get(key);
    if (entry === undefined) return 0;
    return Math.max(0, entry.count - entry.error);
  }

  topK(k: number): SSEntry[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new SSError("k must be an integer >= 1");
    }
    return [...this.entries.values()]
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
    const keys = new Set<string>([...this.entries.keys(), ...other.entries.keys()]);
    const merged = new SpaceSaving(this.capacity);
    for (const key of [...keys].sort()) {
      merged.offer(key, Math.max(this.estimate(key), other.estimate(key)));
    }
    this.entries.clear();
    for (const [key, entry] of merged.entries) {
      this.entries.set(key, entry);
    }
    this.offered = merged.offered;
  }

  exportEntries(): SSEntry[] {
    return [...this.entries.values()]
      .map((e) => ({ ...e }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  static fromEntries(capacity: number, entries: SSEntry[]): SpaceSaving {
    const ss = new SpaceSaving(capacity);
    for (const { key, count, error } of entries) {
      ss.entries.set(key, { key, count, error });
      ss.offered += count;
    }
    return ss;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SSStats {
    return {
      capacity: this.capacity,
      size: this.entries.size,
      totalOffered: this.offered,
      frozen: this.frozen,
    };
  }

  totalOffered(): number {
    return this.offered;
  }
}
