import { VirtualClock } from "./clock.js";
import type { ShardTxnSnapshot, TxnRecord } from "./types.js";
import { TxnStateError } from "./errors.js";
import { routeKey } from "./router.js";
import { ShardStore } from "./shard.js";
import { LockTable } from "./lock.js";
import { prepareShard, isPrepareTimedOut } from "./prepare.js";
import { Journal } from "./journal.js";
import { exportSnapshot, importSnapshot, recoverPreparedTxns } from "./recover.js";

export type ShardTxnOptions = {
  shardCount: number;
  prepareTimeoutMs: number;
};

export class ShardTxn {
  private shards: ShardStore[];
  private txns = new Map<string, TxnRecord>();
  private locks = new LockTable();
  private journal = new Journal();
  private nextTxnNum = 1;

  constructor(
    private readonly clock: VirtualClock,
    private readonly opts: ShardTxnOptions,
  ) {
    this.shards = Array.from({ length: opts.shardCount }, () => new ShardStore());
  }

  routeKey(key: string): number {
    return routeKey(key, this.opts.shardCount);
  }

  begin(): string {
    const txnId = `t${this.nextTxnNum++}`;
    this.txns.set(txnId, {
      txnId,
      status: "active",
      writes: {},
      expectedVersions: {},
      prepareStartedAt: null,
      preparedShards: [],
    });
    return txnId;
  }

  read(txnId: string, key: string): string | undefined {
    const txn = this.requireActive(txnId);
    if (Object.prototype.hasOwnProperty.call(txn.writes, key)) {
      return txn.writes[key];
    }
    const sid = this.routeKey(key);
    return this.shards[sid]!.getValue(key);
  }

  write(txnId: string, key: string, value: string): void {
    const txn = this.requireActive(txnId);
    const sid = this.routeKey(key);
    if (!Object.prototype.hasOwnProperty.call(txn.expectedVersions, key)) {
      txn.expectedVersions[key] = this.shards[sid]!.getVersion(key);
    }
    txn.writes[key] = value;
  }

  commit(txnId: string): { ok: boolean; reason?: string } {
    const txn = this.txns.get(txnId);
    if (!txn || txn.status !== "active") {
      throw new TxnStateError("commit on non-active txn");
    }
    if (Object.keys(txn.writes).length === 0) {
      txn.status = "committed";
      return { ok: true };
    }

    txn.prepareStartedAt = this.clock.now();
    const shardKeys = this.groupByShard(txn.writes);

    const prepared: number[] = [];
    for (const [sid, keys] of shardKeys) {
      const now = this.clock.now();
      if (isPrepareTimedOut(txn.prepareStartedAt, now, this.opts.prepareTimeoutMs)) {
        this.abortInternal(txnId);
        return { ok: false, reason: "timeout" };
      }
      const prep = prepareShard(
        this.shards[sid]!,
        this.locks,
        sid,
        txnId,
        keys,
        txn.expectedVersions,
      );
      if (!prep.ok) {
        this.abortInternal(txnId);
        return { ok: false, reason: prep.reason };
      }
      prepared.push(sid);
      this.journal.append({ kind: "prepare", txnId, shardId: sid, at: now });
    }

    txn.preparedShards = prepared;
    txn.status = "prepared";

    if (prepared.length !== shardKeys.size) {
      this.abortInternal(txnId);
      return { ok: false, reason: "partial-prepare" };
    }

    for (const [sid, keys] of shardKeys) {
      for (const key of keys) {
        this.shards[sid]!.put(key, txn.writes[key]!);
      }
      this.locks.unlockShard(sid, keys);
    }
    txn.status = "committed";
    this.journal.append({ kind: "commit", txnId, at: this.clock.now() });
    return { ok: true };
  }

  abort(txnId: string): void {
    this.abortInternal(txnId);
  }

  private abortInternal(txnId: string): void {
    const txn = this.txns.get(txnId);
    if (!txn || txn.status === "committed" || txn.status === "aborted") return;
    const shardKeys = this.groupByShard(txn.writes);
    this.locks.unlockTxn(txnId, shardKeys);
    txn.status = "aborted";
    txn.preparedShards = [];
    this.journal.append({ kind: "abort", txnId, at: this.clock.now() });
  }

  get(key: string): string | undefined {
    const sid = this.routeKey(key);
    return this.shards[sid]!.getValue(key);
  }

  exportState(): ShardTxnSnapshot {
    return exportSnapshot(this.shards, this.txns, this.journal.all(), this.nextTxnNum);
  }

  importState(state: ShardTxnSnapshot): void {
    importSnapshot(state, this.shards, this.txns);
    this.journal.replace(state.journal ?? []);
    this.nextTxnNum = state.nextTxnNum ?? 1;
    const recovered = recoverPreparedTxns(this.clock, this.opts.prepareTimeoutMs, this.txns);
    for (const txnId of recovered) {
      const txn = this.txns.get(txnId);
      if (!txn || txn.status !== "committed") continue;
      const entry = { kind: "commit", txnId, at: this.clock.now() } as const;
      this.journal.replayCommit(entry, txn.writes, this.shards, (k) => this.routeKey(k));
      this.journal.append(entry);
    }
  }

  /** Test helper: mark txn prepared without commit (simulates crash mid-2PC). */
  forcePrepared(txnId: string): void {
    const txn = this.txns.get(txnId);
    if (!txn || txn.status !== "active") return;
    txn.prepareStartedAt = txn.prepareStartedAt ?? this.clock.now();
    txn.status = "prepared";
    const shardKeys = this.groupByShard(txn.writes);
    txn.preparedShards = [...shardKeys.keys()];
    for (const [sid, keys] of shardKeys) {
      for (const key of keys) {
        this.locks.lock(sid, key, txnId);
      }
    }
  }

  private requireActive(txnId: string): TxnRecord {
    const txn = this.txns.get(txnId);
    if (!txn || txn.status !== "active") {
      throw new TxnStateError("txn not active");
    }
    return txn;
  }

  private groupByShard(writes: Record<string, string>): Map<number, string[]> {
    const m = new Map<number, string[]>();
    for (const key of Object.keys(writes)) {
      const sid = this.routeKey(key);
      const list = m.get(sid) ?? [];
      list.push(key);
      m.set(sid, list);
    }
    return m;
  }
}
