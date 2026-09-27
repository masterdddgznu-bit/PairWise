import type { DeleteOpts, Entry } from "./types.js";

/** Base map store — no versions/tombstones. */
export class EntryStore {
  private readonly map = new Map<string, string>();

  put(key: string, value: string): void {
    this.map.set(key, value);
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  delete(key: string, _opts?: DeleteOpts): boolean {
    return this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  size(): number {
    return this.map.size;
  }

  // feature hooks
  allEntries(): Entry[] {
    return this.keys().map((k) => ({
      key: k,
      value: this.map.get(k)!,
      ver: 0,
      deleted: false,
      expireAt: null,
    }));
  }

  nextVer(): number {
    throw new Error("versioning not implemented");
  }
}
