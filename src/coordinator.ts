import { shardOf } from "./routing.js";
import type { ShardStore } from "./shard_store.js";
import type { Key, TxnId, Value } from "./types.js";

type CoordTxn = {
  /** shard ids this txn has begun on */
  touched: Set<number>;
  status: "open" | "committed" | "aborted";
};

/**
 * Cross-shard transaction coordinator (2PC).
 */
export class Coordinator {
  /** Volatile txn bookkeeping. Lost on crashAndRecover. */
  private txns = new Map<TxnId, CoordTxn>();

  constructor(private readonly shards: ShardStore[]) {
    if (shards.length === 0) throw new Error("need shards");
  }

  private shardIdOf(key: Key): number {
    return shardOf(key, this.shards.length);
  }

  begin(txnId: TxnId): void {
    if (this.txns.has(txnId)) throw new Error(`txn ${txnId} already exists`);
    this.txns.set(txnId, { touched: new Set(), status: "open" });
  }

  get(txnId: TxnId, key: Key): Value | undefined {
    const shardId = this.shardIdOf(key);
    this.ensureOnShard(txnId, shardId);
    return this.shards[shardId]!.get(txnId, key);
  }

  put(txnId: TxnId, key: Key, value: Value): void {
    const shardId = this.shardIdOf(key);
    this.ensureOnShard(txnId, shardId);
    this.shards[shardId]!.put(txnId, key, value);
  }

  del(txnId: TxnId, key: Key): void {
    const shardId = this.shardIdOf(key);
    this.ensureOnShard(txnId, shardId);
    this.shards[shardId]!.del(txnId, key);
  }

  /**
   * 2PC commit across all shards touched by this txn.
   * If any prepare fails, abort all participants and throw.
   */
  commit(txnId: TxnId): void {
    const txn = this.txns.get(txnId);
    if (txn) {
      if (txn.status === "committed") return;
      if (txn.status === "aborted") {
        throw new Error(`txn ${txnId} already aborted`);
      }
      const participants = [...txn.touched].map((i) => this.shards[i]!);
      try {
        for (const shard of participants) shard.prepare(txnId);
      } catch (err) {
        for (const shard of participants) {
          try {
            shard.abortPrepared(txnId);
          } catch {
            // best-effort abort of remaining participants
          }
        }
        txn.status = "aborted";
        throw err;
      }
      for (const shard of participants) shard.commitPrepared(txnId);
      txn.status = "committed";
      return;
    }
    // Recovered path: volatile touch-set lost. Finalize in-doubt participants
    // from their durable prepare records.
    const prepared = this.shards.filter((s) => s.stateOf(txnId) === "prepared");
    if (prepared.length === 0) {
      if (this.shards.some((s) => s.stateOf(txnId) === "committed")) return;
      throw new Error(`unknown txn ${txnId}`);
    }
    for (const shard of prepared) shard.commitPrepared(txnId);
  }

  abort(txnId: TxnId): void {
    const txn = this.txns.get(txnId);
    if (txn) {
      if (txn.status === "aborted") return;
      if (txn.status === "committed") {
        throw new Error(`txn ${txnId} already committed`);
      }
      for (const i of txn.touched) {
        this.shards[i]!.abortPrepared(txnId);
      }
      txn.status = "aborted";
      return;
    }
    // Recovered path: abortPrepared is idempotent and a no-op when unknown.
    for (const shard of this.shards) shard.abortPrepared(txnId);
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

  private ensureOnShard(txnId: TxnId, shardId: number): void {
    const txn = this.txns.get(txnId);
    if (!txn) throw new Error(`unknown txn ${txnId}`);
    if (txn.status !== "open") {
      throw new Error(`txn ${txnId} is ${txn.status}`);
    }
    if (!txn.touched.has(shardId)) {
      this.shards[shardId]!.begin(txnId);
      txn.touched.add(shardId);
    }
  }
}
