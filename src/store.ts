import type { VirtualClock } from "./clock.js";
import type { DeleteOpts, DiffOp, Entry } from "./types.js";

/** Versioned entry store with tombstones. */
export class EntryStore {
  private readonly map = new Map<string, Entry>();
  private ver = 0;

  constructor(private readonly clock: VirtualClock) {}

  put(key: string, value: string): void {
    const ver = this.nextVer();
    this.map.set(key, { key, value, ver, deleted: false, expireAt: null });
  }

  get(key: string): string | undefined {
    const e = this.map.get(key);
    if (!e || e.deleted) return undefined;
    return e.value;
  }

  delete(key: string, opts?: DeleteOpts): boolean {
    const existing = this.map.get(key);
    if (!existing || existing.deleted) return false;
    const ver = this.nextVer();
    const expireAt =
      opts?.ttlMs === undefined ? null : this.clock.now() + opts.ttlMs;
    this.map.set(key, {
      key,
      value: "",
      ver,
      deleted: true,
      expireAt,
    });
    return true;
  }

  has(key: string): boolean {
    const e = this.map.get(key);
    return !!e && !e.deleted;
  }

  keys(): string[] {
    return this.liveEntries().map((e) => e.key);
  }

  size(): number {
    return this.liveEntries().length;
  }

  allEntries(): Entry[] {
    return [...this.map.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
  }

  liveEntries(): Entry[] {
    return this.allEntries().filter((e) => !e.deleted);
  }

  nextVer(): number {
    this.ver += 1;
    return this.ver;
  }

  applyOps(ops: DiffOp[]): void {
    for (const op of ops) {
      const ver = this.ver >= op.ver ? this.ver : op.ver;
      this.ver = ver;
      this.map.set(op.key, {
        key: op.key,
        value: op.deleted ? "" : op.value,
        ver: op.ver,
        deleted: op.deleted,
        expireAt: null,
      });
    }
  }

  tick(): void {
    const now = this.clock.now();
    for (const [key, entry] of this.map) {
      if (
        entry.deleted &&
        entry.expireAt !== null &&
        now >= entry.expireAt
      ) {
        this.map.delete(key);
      }
    }
  }
}
