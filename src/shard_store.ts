import type { LogicalClock } from "./clock.js";
import type {
  Key,
  LogicalTime,
  PrepareRecord,
  TxnId,
  TxnState,
  Value,
} from "./types.js";

/**
 * Single-shard MVCC store with optional durable prepare log for 2PC.
 *
 * INTENTIONALLY INCOMPLETE — implement until tests pass.
 */
export class ShardStore {
  constructor(
    readonly shardId: number,
    private readonly clock: LogicalClock,
  ) {}

  begin(txnId: TxnId): { readTs: LogicalTime } {
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

  /** Local single-shard commit (no 2PC). */
  commit(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  abort(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  /**
   * 2PC prepare: validate ww-conflicts against readTs; durably record prepare.
   * Must be idempotent for the same txnId.
   */
  prepare(txnId: TxnId): PrepareRecord {
    throw new Error("not implemented");
  }

  /** Finish 2PC after all participants prepared. Idempotent. */
  commitPrepared(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  /** Abort a prepared or open txn. Idempotent. */
  abortPrepared(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  /**
   * Simulate crash: drop all in-memory txn session state EXCEPT durable
   * prepare log + committed version chains. Used by recovery tests.
   */
  crash(): void {
    throw new Error("not implemented");
  }

  /** After crash, restore open/prepared bookkeeping from durable prepare log. */
  recover(): void {
    throw new Error("not implemented");
  }

  stateOf(txnId: TxnId): TxnState | undefined {
    throw new Error("not implemented");
  }

  /** Test helper: committed versions for a key, oldest -> newest. */
  debugVersions(key: Key): Array<{ value: Value | null; commitTs: LogicalTime }> {
    throw new Error("not implemented");
  }
}
