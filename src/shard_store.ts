import type { LogicalClock } from "./clock.js";
import type {
  Key,
  LogicalTime,
  PrepareRecord,
  TxnId,
  TxnState,
  Value,
  VersionedValue,
} from "./types.js";

type ActiveTxn = {
  readTs: LogicalTime;
  writes: Map<Key, Value | null>;
  state: "open" | "prepared";
};

/**
 * Single-shard MVCC store with optional durable prepare log for 2PC.
 */
export class ShardStore {
  /** Committed version chains per key, ascending commitTs. Survives crash. */
  private readonly versions = new Map<Key, VersionedValue[]>();
  /** Volatile open/prepared txn sessions. Lost on crash. */
  private txns = new Map<TxnId, ActiveTxn>();
  /** Volatile finalized txn outcomes. Lost on crash. */
  private finished = new Map<TxnId, "committed" | "aborted">();
  /** Durable prepare log. Survives crash. */
  private readonly prepareLog = new Map<TxnId, PrepareRecord>();

  constructor(
    readonly shardId: number,
    private readonly clock: LogicalClock,
  ) {}

  begin(txnId: TxnId): { readTs: LogicalTime } {
    const existing = this.txns.get(txnId);
    if (existing) return { readTs: existing.readTs };
    if (this.finished.has(txnId)) {
      throw new Error(`txn ${txnId} already finalized on shard ${this.shardId}`);
    }
    const readTs = this.clock.now();
    this.txns.set(txnId, { readTs, writes: new Map(), state: "open" });
    return { readTs };
  }

  get(txnId: TxnId, key: Key): Value | undefined {
    const txn = this.mustActive(txnId);
    if (txn.writes.has(key)) return txn.writes.get(key) ?? undefined;
    const chain = this.versions.get(key);
    if (!chain) return undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i]!;
      if (v.commitTs <= txn.readTs) return v.value ?? undefined;
    }
    return undefined;
  }

  put(txnId: TxnId, key: Key, value: Value): void {
    const txn = this.mustActive(txnId);
    if (txn.state !== "open") throw new Error(`txn ${txnId} is ${txn.state}`);
    txn.writes.set(key, value);
  }

  del(txnId: TxnId, key: Key): void {
    const txn = this.mustActive(txnId);
    if (txn.state !== "open") throw new Error(`txn ${txnId} is ${txn.state}`);
    txn.writes.set(key, null);
  }

  /** Local single-shard commit (no 2PC). */
  commit(txnId: TxnId): void {
    const txn = this.mustActive(txnId);
    this.checkConflicts(txnId, txn);
    const commitTs = this.clock.tick();
    for (const [key, value] of txn.writes) {
      this.appendVersion(key, value, commitTs);
    }
    this.txns.delete(txnId);
    this.finished.set(txnId, "committed");
  }

  abort(txnId: TxnId): void {
    if (this.finished.has(txnId)) return;
    this.prepareLog.delete(txnId);
    if (this.txns.delete(txnId)) {
      this.finished.set(txnId, "aborted");
    }
  }

  /**
   * 2PC prepare: validate ww-conflicts against readTs; durably record prepare.
   * Must be idempotent for the same txnId.
   */
  prepare(txnId: TxnId): PrepareRecord {
    const existing = this.prepareLog.get(txnId);
    if (existing) return existing;
    const txn = this.mustActive(txnId);
    this.checkConflicts(txnId, txn);
    const record: PrepareRecord = {
      txnId,
      writes: [...txn.writes.entries()].map(([key, value]) => ({ key, value })),
      readTs: txn.readTs,
      preparedAt: this.clock.tick(),
    };
    this.prepareLog.set(txnId, record);
    txn.state = "prepared";
    return record;
  }

  /** Finish 2PC after all participants prepared. Idempotent. */
  commitPrepared(txnId: TxnId): void {
    if (this.finished.get(txnId) === "committed") return;
    const record = this.prepareLog.get(txnId);
    if (!record) {
      // Unknown or already finalized before a crash: no-op for idempotency.
      this.txns.delete(txnId);
      return;
    }
    const commitTs = this.clock.tick();
    for (const w of record.writes) {
      this.appendVersion(w.key, w.value, commitTs);
    }
    this.prepareLog.delete(txnId);
    this.txns.delete(txnId);
    this.finished.set(txnId, "committed");
  }

  /** Abort a prepared or open txn. Idempotent. */
  abortPrepared(txnId: TxnId): void {
    if (this.finished.get(txnId) === "committed") return;
    const hadRecord = this.prepareLog.delete(txnId);
    const hadTxn = this.txns.delete(txnId);
    if (hadRecord || hadTxn) {
      this.finished.set(txnId, "aborted");
    }
  }

  /**
   * Simulate crash: drop all in-memory txn session state EXCEPT durable
   * prepare log + committed version chains. Used by recovery tests.
   */
  crash(): void {
    this.txns.clear();
    this.finished.clear();
  }

  /** After crash, restore open/prepared bookkeeping from durable prepare log. */
  recover(): void {
    for (const record of this.prepareLog.values()) {
      this.txns.set(record.txnId, {
        readTs: record.readTs,
        writes: new Map(record.writes.map((w) => [w.key, w.value])),
        state: "prepared",
      });
    }
  }

  stateOf(txnId: TxnId): TxnState | undefined {
    const txn = this.txns.get(txnId);
    if (txn) return txn.state;
    return this.finished.get(txnId);
  }

  /** Test helper: committed versions for a key, oldest -> newest. */
  debugVersions(key: Key): Array<{ value: Value | null; commitTs: LogicalTime }> {
    return (this.versions.get(key) ?? []).map((v) => ({
      value: v.value,
      commitTs: v.commitTs,
    }));
  }

  private mustActive(txnId: TxnId): ActiveTxn {
    const txn = this.txns.get(txnId);
    if (!txn) {
      throw new Error(`txn ${txnId} not active on shard ${this.shardId}`);
    }
    return txn;
  }

  private checkConflicts(txnId: TxnId, txn: ActiveTxn): void {
    for (const key of txn.writes.keys()) {
      const chain = this.versions.get(key);
      const latest = chain?.[chain.length - 1];
      if (latest && latest.commitTs > txn.readTs) {
        this.txns.delete(txnId);
        this.finished.set(txnId, "aborted");
        throw new Error(
          `ww conflict on key "${key}": aborting txn ${txnId}`,
        );
      }
    }
  }

  private appendVersion(
    key: Key,
    value: Value | null,
    commitTs: LogicalTime,
  ): void {
    let chain = this.versions.get(key);
    if (!chain) {
      chain = [];
      this.versions.set(key, chain);
    }
    chain.push({ value, commitTs });
  }
}
