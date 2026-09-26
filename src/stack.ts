import { VirtualClock } from "./clock.js";
import { LayerStack } from "./layers.js";
import { RevisionCounter } from "./revision.js";
import { SchemaRegistry } from "./schema.js";
import { SnapshotStore } from "./snapshot.js";
import { TtlIndex } from "./ttl.js";
import { applyTxn } from "./txn.js";
import type { SchemaKind, TxnOp, VersionedValue, WatchEvent } from "./types.js";
import { WatchManager } from "./watch.js";

/**
 * Hierarchical config stack.
 * Base single-layer set/get/delete/list/currentRevision work.
 * Feature methods wired to unfinished modules.
 */
export class CfgStack {
  readonly clock: VirtualClock;
  /** @internal */ readonly revisions: RevisionCounter;
  /** @internal */ readonly layerStack: LayerStack;
  /** @internal */ readonly watches: WatchManager;
  /** @internal */ readonly ttl: TtlIndex;
  /** @internal */ readonly schemas: SchemaRegistry;
  /** @internal */ readonly snapshots: SnapshotStore;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.revisions = new RevisionCounter();
    this.layerStack = new LayerStack();
    this.watches = new WatchManager();
    this.ttl = new TtlIndex();
    this.schemas = new SchemaRegistry();
    this.snapshots = new SnapshotStore();
  }

  currentRevision(): number {
    return this.revisions.current();
  }

  layers(): string[] {
    return this.layerStack.layers();
  }

  set(key: string, value: string): number {
    this.schemas.validate(key, value);
    this.ttl.clear(key);
    const revision = this.revisions.next();
    this.layerStack.setOnBase(key, value, revision);
    this.watches.notify({ type: "set", key, value, revision });
    return revision;
  }

  get(key: string): VersionedValue | null {
    return this.layerStack.resolve(key);
  }

  delete(key: string): number | null {
    if (!this.layerStack.resolve(key)) return null;
    this.ttl.clear(key);
    const revision = this.revisions.next();
    this.layerStack.setOnBase(key, null, revision);
    this.watches.notify({ type: "delete", key, value: null, revision });
    return revision;
  }

  list(): string[] {
    return this.layerStack.listKeys();
  }

  pushLayer(name: string): void {
    this.layerStack.pushLayer(name);
  }

  popLayer(): void {
    this.layerStack.popLayer();
  }

  setOn(layer: string, key: string, value: string): number {
    this.schemas.validate(key, value);
    this.ttl.clear(key);
    const revision = this.revisions.next();
    this.layerStack.setOn(layer, key, value, revision);
    this.watches.notify({ type: "set", key, value, revision });
    return revision;
  }

  deleteOn(layer: string, key: string): number | null {
    throw new Error("deleteOn not implemented");
  }

  setTtl(key: string, value: string, ttlMs: number): number {
    void ttlMs;
    throw new Error("setTtl not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  watch(prefix: string, fromRevision: number): string {
    return this.watches.watch(prefix, fromRevision);
  }

  pollWatch(watchId: string): WatchEvent[] {
    return this.watches.pollWatch(watchId);
  }

  unwatch(watchId: string): void {
    this.watches.unwatch(watchId);
  }

  txn(ops: TxnOp[]): number {
    return applyTxn(this, ops);
  }

  snapshot(): string {
    return this.snapshots.snapshot(this);
  }

  restore(snapId: string): void {
    this.snapshots.restore(this, snapId);
  }

  setSchema(key: string, kind: SchemaKind): void {
    this.schemas.setSchema(key, kind);
  }

  compact(beforeRevision: number): void {
    this.watches.compact(beforeRevision);
  }
}
