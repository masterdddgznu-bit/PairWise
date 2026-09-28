import { VirtualClock } from "./clock.js";
import { diffMaps } from "./diff.js";
import { SnapNotFoundError } from "./errors.js";
import { collectUnreachable } from "./gc.js";
import { MapRoot } from "./root.js";
import type { DiffResult, SnapOpts, Stats } from "./types.js";
import { VersionPool } from "./version.js";

type SnapshotEntry = {
  root: MapRoot;
  expireAt: number | null;
};

/**
 * Copy-on-write snapshot store.
 * HEAD is the writable view; snapshots share version nodes with HEAD
 * until a write copies the changed key's node.
 */
export class SnapStore {
  readonly clock: VirtualClock;
  /** @internal */ readonly head: MapRoot;
  /** @internal */ private readonly pool = new VersionPool();
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private nextSnapId = 1;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.head = new MapRoot(this.pool);
  }

  put(key: string, value: string): void {
    this.head.put(key, value);
  }

  get(key: string): string | undefined {
    return this.head.get(key);
  }

  delete(key: string): boolean {
    return this.head.delete(key);
  }

  has(key: string): boolean {
    return this.head.has(key);
  }

  keys(): string[] {
    return this.head.keys();
  }

  size(): number {
    return this.head.size();
  }

  snapshot(opts?: SnapOpts): string {
    const id = `s${this.nextSnapId++}`;
    const expireAt =
      opts?.ttlMs === undefined ? null : this.clock.now() + opts.ttlMs;
    this.snapshots.set(id, {
      root: MapRoot.share(this.pool, this.head),
      expireAt,
    });
    return id;
  }

  private requireSnap(snapId: string): SnapshotEntry {
    const entry = this.snapshots.get(snapId);
    if (!entry) throw new SnapNotFoundError(`Snapshot not found: ${snapId}`);
    return entry;
  }

  getAt(snapId: string, key: string): string | undefined {
    return this.requireSnap(snapId).root.get(key);
  }

  hasAt(snapId: string, key: string): boolean {
    return this.requireSnap(snapId).root.has(key);
  }

  keysAt(snapId: string): string[] {
    return this.requireSnap(snapId).root.keys();
  }

  sizeAt(snapId: string): number {
    return this.requireSnap(snapId).root.size();
  }

  fork(snapId: string): void {
    const entry = this.requireSnap(snapId);
    this.head.replaceWith(entry.root);
  }

  diff(a: string, b: string): DiffResult {
    const dataA = this.requireSnap(a).root.toDataMap();
    const dataB = this.requireSnap(b).root.toDataMap();
    return diffMaps(dataA, dataB);
  }

  drop(snapId: string): boolean {
    const entry = this.snapshots.get(snapId);
    if (!entry) return false;
    this.snapshots.delete(snapId);
    entry.root.releaseAll();
    collectUnreachable(this.pool);
    return true;
  }

  listSnapshots(): string[] {
    return [...this.snapshots.keys()].sort();
  }

  tick(): void {
    const now = this.clock.now();
    for (const [id, entry] of [...this.snapshots]) {
      if (entry.expireAt !== null && entry.expireAt <= now) {
        this.snapshots.delete(id);
        entry.root.releaseAll();
      }
    }
    collectUnreachable(this.pool);
  }

  stats(): Stats {
    return {
      snapshots: this.snapshots.size,
      versions: this.pool.liveCount(),
    };
  }
}
