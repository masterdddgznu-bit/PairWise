import type { Dot, Entry } from "./types.js";
import { dotWins } from "./dot.js";

export class EntryStore {
  private readonly byKey = new Map<string, Entry>();

  private static clone(e: Entry): Entry {
    return { key: e.key, value: e.value, dot: { ...e.dot } };
  }

  private set(key: string, value: string | null, dot: Dot): void {
    this.byKey.set(key, { key, value, dot: { ...dot } });
  }

  put(key: string, value: string, dot: Dot): void {
    this.set(key, value, dot);
  }

  /** Write a tombstone only when the key is currently live. */
  tombstone(key: string, dot: Dot): boolean {
    const cur = this.byKey.get(key);
    if (!cur || cur.value === null) return false;
    this.set(key, null, dot);
    return true;
  }

  private isLive(e: Entry | undefined): e is Entry & { value: string } {
    return e !== undefined && e.value !== null;
  }

  getValue(key: string): string | undefined {
    const e = this.byKey.get(key);
    return this.isLive(e) ? e.value : undefined;
  }

  has(key: string): boolean {
    return this.isLive(this.byKey.get(key));
  }

  getEntry(key: string): Entry | undefined {
    const e = this.byKey.get(key);
    return e ? EntryStore.clone(e) : undefined;
  }

  keys(): string[] {
    return this.all()
      .filter((e) => e.value !== null)
      .map((e) => e.key);
  }

  size(): number {
    let n = 0;
    for (const e of this.byKey.values()) if (e.value !== null) n++;
    return n;
  }

  all(): Entry[] {
    return [...this.byKey.values()]
      .map(EntryStore.clone)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** LWW-merge a single entry; equal dots keep the local one. */
  applyLww(e: Entry): void {
    const cur = this.byKey.get(e.key);
    if (!cur || dotWins(e.dot, cur.dot)) {
      this.set(e.key, e.value, e.dot);
    }
  }

  removeTombstones(pred: (e: Entry) => boolean): number {
    let removed = 0;
    for (const [key, e] of this.byKey) {
      if (e.value === null && pred(e)) {
        this.byKey.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
