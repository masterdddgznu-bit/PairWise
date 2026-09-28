import type { DeleteOpts, Entry } from "./types.js";

/** Versioned entry store with tombstones. */
export class EntryStore {
  private readonly map = new Map<string, Entry>();
  private ver = 0;

  put(key: string, value: string): void {
    this.map.set(key, {
      key,
      value,
      ver: this.nextVer(),
      deleted: false,
      expireAt: null,
    });
  }

  get(key: string): string | undefined {
    const e = this.map.get(key);
    return e && !e.deleted ? e.value : undefined;
  }

  delete(key: string, opts?: DeleteOpts, now = 0): boolean {
    const e = this.map.get(key);
    if (!e || e.deleted) return false;
    this.map.set(key, {
      key,
      value: e.value,
      ver: this.nextVer(),
      deleted: true,
      expireAt: opts?.ttlMs !== undefined ? now + opts.ttlMs : null,
    });
    return true;
  }

  has(key: string): boolean {
    const e = this.map.get(key);
    return e !== undefined && !e.deleted;
  }

  keys(): string[] {
    return this.liveEntries().map((e) => e.key);
  }

  size(): number {
    return this.liveEntries().length;
  }

  liveEntries(): Entry[] {
    return [...this.map.values()]
      .filter((e) => !e.deleted)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  allEntries(): Entry[] {
    return [...this.map.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
  }

  applyEntry(entry: Entry): void {
    this.map.set(entry.key, { ...entry });
    if (entry.ver > this.ver) this.ver = entry.ver;
  }

  tick(now: number): void {
    for (const [key, e] of this.map) {
      if (e.deleted && e.expireAt !== null && now >= e.expireAt) {
        this.map.delete(key);
      }
    }
  }

  nextVer(): number {
    return ++this.ver;
  }
}
