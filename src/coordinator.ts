import { shardOf } from "./routing.js";
import type { ShardStore } from "./shard_store.js";
import type { Key, TxnId, Value } from "./types.js";

/**
 * Cross-shard transaction coordinator (2PC).
 */
export class Coordinator {
  /** Volatile per-txn set of shard ids that have been begun. Lost on crash. */
  private readonly txns = new Map<TxnId, Set<number>>();

  constructor(private readonly shards: ShardStore[]) {
    if (shards.length === 0) throw new Error("need shards");
  }

  private shardCount(): number {
    return this.shards.length;
  }

  private store(key: Key): ShardStore {
    return this.shards[shardOf(key, this.shardCount())]!;
  }

  begin(txnId: TxnId): void {
    this.txns.set(txnId, new Set());
  }

  get(txnId: TxnId, key: Key): Value | undefined {
    const store = this.store(key);
    this.ensureBegun(txnId, store.shardId);
    return store.get(txnId, key);
  }

  put(txnId: TxnId, key: Key, value: Value): void {
    const store = this.store(key);
    this.ensureBegun(txnId, store.shardId);
    store.put(txnId, key, value);
  }

  del(txnId: TxnId, key: Key): void {
    const store = this.store(key);
    this.ensureBegun(txnId, store.shardId);
    store.del(txnId, key);
  }

  /**
   * 2PC commit across all shards touched by this txn.
   * If any prepare fails, abort all participants and throw.
   */
  commit(txnId: TxnId): void {
    const participants = this.participants(txnId);
    try {
      for (const shard of participants) shard.prepare(txnId);
    } catch (err) {
      for (const shard of participants) shard.abortPrepared(txnId);
      this.txns.delete(txnId);
      throw err;
    }
    for (const shard of participants) shard.commitPrepared(txnId);
    this.txns.delete(txnId);
  }

  abort(txnId: TxnId): void {
    for (const shard of this.participants(txnId)) shard.abortPrepared(txnId);
    this.txns.delete(txnId);
  }

  /**
   * Crash every shard (lose volatile state, keep durable prepare), then recover.
   * Coordinator volatile routing/txn touch-sets may also be lost — recover must
   * still finalize in-doubt txns safely when commit/abort is retried.
   */
  crashAndRecover(): void {
    for (const shard of this.shards) shard.crash();
    for (const shard of this.shards) shard.recover();
    this.txns.clear();
  }

  private ensureBegun(txnId: TxnId, shardId: number): void {
    const touched = this.txns.get(txnId);
    if (!touched) throw new Error(`unknown txn ${txnId}`);
    if (!touched.has(shardId)) {
      this.shards[shardId]!.begin(txnId);
      touched.add(shardId);
    }
  }

  /**
   * Shards participating in this txn. Falls back to durable prepare records
   * so in-doubt txns can still be finalized after a coordinator crash.
   */
  private participants(txnId: TxnId): ShardStore[] {
    const touched = this.txns.get(txnId);
    if (touched) {
      return [...touched].map((id) => this.shards[id]!);
    }
    const prepared = this.shards.filter(
      (s) => s.stateOf(txnId) === "prepared",
    );
    if (prepared.length === 0) throw new Error(`unknown txn ${txnId}`);
    return prepared;
  }
}
