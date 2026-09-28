import { VirtualClock } from "./clock.js";
import { diffRoots } from "./diff.js";
import { SnapNotFoundError } from "./errors.js";
import { releaseRoot, replaceHead, retainRoot } from "./gc.js";
import { MapRoot } from "./root.js";
import { VersionPool } from "./version.js";
import type { DiffResult, SnapOpts, Stats } from "./types.js";

type Snapshot = {
  id: string;
  root: MapRoot;
  expireAt?: number;
};

/**
 * Copy-on-write snapshot store.
 */
export class SnapStore {
  readonly clock: VirtualClock;
  /** @internal */ readonly head: MapRoot;
  /** @internal */ readonly pool: VersionPool;
  private readonly snapshots = new Map<string, Snapshot>();
  private nextSnapSeq = 1;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.pool = new VersionPool();
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

  snapshot(_opts?: SnapOpts): string {
    const root = this.head.clone();
    retainRoot(root);
    const id = `s${this.nextSnapSeq++}`;
    const snap: Snapshot = {
      id,
      root,
      expireAt:
        _opts?.ttlMs === undefined ? undefined : this.clock.now() + _opts.ttlMs,
    };
    this.snapshots.set(id, snap);
    return id;
  }

  getAt(snapId: string, key: string): string | undefined {
    return this.requireSnapshot(snapId).root.get(key);
  }

  hasAt(snapId: string, key: string): boolean {
    return this.requireSnapshot(snapId).root.has(key);
  }

  keysAt(snapId: string): string[] {
    return this.requireSnapshot(snapId).root.keys();
  }

  sizeAt(snapId: string): number {
    return this.requireSnapshot(snapId).root.size();
  }

  fork(snapId: string): void {
    const snap = this.requireSnapshot(snapId);
    replaceHead(this.head, snap.root);
  }

  diff(a: string, b: string): DiffResult {
    const rootA = this.requireSnapshot(a).root;
    const rootB = this.requireSnapshot(b).root;
    return diffRoots(rootA, rootB);
  }

  drop(snapId: string): boolean {
    const snap = this.snapshots.get(snapId);
    if (!snap) return false;
    this.snapshots.delete(snapId);
    releaseRoot(snap.root);
    return true;
  }

  listSnapshots(): string[] {
    return [...this.snapshots.keys()].sort();
  }

  tick(): void {
    const now = this.clock.now();
    for (const [id, snap] of this.snapshots) {
      if (snap.expireAt !== undefined && snap.expireAt <= now) {
        this.snapshots.delete(id);
        releaseRoot(snap.root);
      }
    }
  }

  stats(): Stats {
    return {
      snapshots: this.snapshots.size,
      versions: this.pool.liveCount(),
    };
  }

  private requireSnapshot(snapId: string): Snapshot {
    const snap = this.snapshots.get(snapId);
    if (!snap) throw new SnapNotFoundError(`Snapshot not found: ${snapId}`);
    return snap;
  }
}
