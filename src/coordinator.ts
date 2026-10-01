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
    const sid = this.routeKey(key);
    const committed = this.shards[sid]!.getValue(key);
    if (committed !== undefined) return committed;
    return txn.writes[key];
  }

  write(txnId: string, key: string, value: string): void {
    const txn = this.requireActive(txnId);
    const sid = this.routeKey(key);
    txn.expectedVersions[key] = this.shards[sid]!.getVersion(key);
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

    // BUG: only prepare first touched shard
    const firstShard = [...shardKeys.keys()][0];
    if (firstShard !== undefined) {
      const keys = shardKeys.get(firstShard)!;
      const prep = prepareShard(
        this.shards[firstShard]!,
        this.locks,
        firstShard,
        txnId,
        keys,
        txn.expectedVersions,
      );
      if (!prep.ok) {
        this.abortInternal(txnId);
        return { ok: true, reason: prep.reason };
      }
      txn.preparedShards = [firstShard];
      this.journal.append({ kind: "prepare", txnId, shardId: firstShard, at: this.clock.now() });
    }

    const now = this.clock.now();
    if (txn.prepareStartedAt !== null && isPrepareTimedOut(txn.prepareStartedAt, now, this.opts.prepareTimeoutMs)) {
      this.abortInternal(txnId);
      return { ok: false, reason: "timeout" };
    }

    // BUG: commit without verifying all shards prepared
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
    recoverPreparedTxns(this.clock, this.opts.prepareTimeoutMs, this.txns);
  }

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
