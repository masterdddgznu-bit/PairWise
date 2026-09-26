import { applyCas } from "./cas.js";
import { VirtualClock } from "./clock.js";
import { HistoryLog } from "./history.js";
import { RevisionCounter } from "./revision.js";
import { TtlIndex } from "./ttl.js";
import { applyTxn } from "./txn.js";
import type { HistoryRecord, TxnOp, VersionedValue, WatchEvent } from "./types.js";
import { WatchManager } from "./watch.js";

/**
 * Revisioned KV store.
 * Base put/get/delete/list/currentRevision work.
 * Feature methods are wired to unfinished modules.
 */
export class RevStore {
  readonly clock: VirtualClock;
  /** @internal */ readonly revisions: RevisionCounter;
  /** @internal */ readonly data = new Map<string, VersionedValue>();
  /** @internal */ readonly historyLog: HistoryLog;
  /** @internal */ readonly watches: WatchManager;
  /** @internal */ readonly ttl: TtlIndex;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.revisions = new RevisionCounter();
    this.historyLog = new HistoryLog();
    this.watches = new WatchManager();
    this.ttl = new TtlIndex();
  }

  currentRevision(): number {
    return this.revisions.current();
  }

  put(key: string, value: string): number {
    this.ttl.clear(key);
    const revision = this.revisions.next();
    this.data.set(key, { value, revision });
    this.historyLog.append(key, revision, value);
    this.watches.notify({ type: "put", key, value, revision });
    return revision;
  }

  get(key: string): VersionedValue | null {
    const cur = this.data.get(key);
    return cur ? { value: cur.value, revision: cur.revision } : null;
  }

  delete(key: string): number | null {
    if (!this.data.has(key)) return null;
    this.ttl.clear(key);
    const revision = this.revisions.next();
    this.data.delete(key);
    this.historyLog.append(key, revision, null);
    this.watches.notify({ type: "delete", key, value: null, revision });
    return revision;
  }

  list(): string[] {
    return [...this.data.keys()].sort();
  }

  cas(key: string, expectedRevision: number, value: string): number {
    return applyCas(this, key, expectedRevision, value);
  }

  getAt(key: string, revision: number): VersionedValue | null {
    return this.historyLog.getAt(key, revision);
  }

  history(key: string): HistoryRecord[] {
    return this.historyLog.history(key);
  }

  putTtl(key: string, value: string, ttlMs: number): number {
    const revision = this.put(key, value);
    this.ttl.schedule(this.clock, key, ttlMs);
    return revision;
  }

  tick(): void {
    const now = this.clock.now();
    for (const key of this.ttl.expiredKeys(now)) {
      // delete() clears the TTL entry, bumps revision, appends history,
      // and notifies watches.
      this.delete(key);
    }
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

  compact(beforeRevision: number): void {
    this.historyLog.compact(beforeRevision);
    this.watches.compact(beforeRevision);
  }
}
