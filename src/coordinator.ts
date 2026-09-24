import { shardOf } from "./routing.js";
import type { ShardStore } from "./shard_store.js";
import type { Key, TxnId, Value } from "./types.js";

/**
 * Cross-shard transaction coordinator (2PC).
 *
 * INTENTIONALLY INCOMPLETE — implement until tests pass.
 */
export class Coordinator {
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
    throw new Error("not implemented");
  }

  get(txnId: TxnId, key: Key): Value | undefined {
    throw new Error("not implemented");
  }

  put(txnId: TxnId, key: Key, value: Value): void {
    throw new Error("not implemented");
  }

  del(txnId: TxnId, key: Key): void {
    throw new Error("not implemented");
  }

  /**
   * 2PC commit across all shards touched by this txn.
   * If any prepare fails, abort all participants and throw.
   */
  commit(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  abort(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  /**
   * Crash every shard (lose volatile state, keep durable prepare), then recover.
   * Coordinator volatile routing/txn touch-sets may also be lost — recover must
   * still finalize in-doubt txns safely when commit/abort is retried.
   */
  crashAndRecover(): void {
    throw new Error("not implemented");
  }
}
