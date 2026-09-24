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

type TxnSession = {
  readTs: LogicalTime;
  writes: Map<Key, Value | null>;
  state: TxnState;
};

/**
 * Single-shard MVCC store with optional durable prepare log for 2PC.
 */
export class ShardStore {
  /** Committed version chains per key, oldest -> newest. Survives crash. */
  private readonly versions = new Map<Key, VersionedValue[]>();
  /** Volatile txn sessions. Dropped on crash, rebuilt from durable log. */
  private readonly txns = new Map<TxnId, TxnSession>();
  /** Durable prepare log. Survives crash. */
  private readonly durablePrepare = new Map<TxnId, PrepareRecord>();

  constructor(
    readonly shardId: number,
    private readonly clock: LogicalClock,
  ) {}

  begin(txnId: TxnId): { readTs: LogicalTime } {
    const readTs = this.clock.now();
    this.txns.set(txnId, { readTs, writes: new Map(), state: "open" });
    return { readTs };
  }

  get(txnId: TxnId, key: Key): Value | undefined {
    const session = this.mustOpen(txnId);
    if (session.writes.has(key)) {
      const own = session.writes.get(key)!;
      return own === null ? undefined : own;
    }
    const chain = this.versions.get(key);
    if (!chain) return undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i]!;
      if (v.commitTs <= session.readTs) {
        return v.value === null ? undefined : v.value;
      }
    }
    return undefined;
  }

  put(txnId: TxnId, key: Key, value: Value): void {
    this.mustOpen(txnId).writes.set(key, value);
  }

  del(txnId: TxnId, key: Key): void {
    this.mustOpen(txnId).writes.set(key, null);
  }

  /** Local single-shard commit (no 2PC). */
  commit(txnId: TxnId): void {
    const session = this.mustOpen(txnId);
    this.checkWriteConflicts(txnId, session);
    if (session.writes.size > 0) {
      const commitTs = this.clock.tick();
      for (const [key, value] of session.writes) {
        this.appendVersion(key, { value, commitTs });
      }
    }
    session.writes.clear();
    session.state = "committed";
  }

  abort(txnId: TxnId): void {
    const session = this.txns.get(txnId);
    if (!session || session.state !== "open") return;
    session.writes.clear();
    session.state = "aborted";
  }

  /**
   * 2PC prepare: validate ww-conflicts against readTs; durably record prepare.
   * Must be idempotent for the same txnId.
   */
  prepare(txnId: TxnId): PrepareRecord {
    const existing = this.durablePrepare.get(txnId);
    if (existing) return existing;
    const session = this.mustOpen(txnId);
    this.checkWriteConflicts(txnId, session);
    const record: PrepareRecord = {
      txnId,
      writes: [...session.writes.entries()].map(([key, value]) => ({
        key,
        value,
      })),
      readTs: session.readTs,
      preparedAt: this.clock.tick(),
    };
    this.durablePrepare.set(txnId, record);
    session.state = "prepared";
    return record;
  }

  /** Finish 2PC after all participants prepared. Idempotent. */
  commitPrepared(txnId: TxnId): void {
    const session = this.txns.get(txnId);
    if (session?.state === "committed") return;
    const record = this.durablePrepare.get(txnId);
    if (!record) return; // already finalized or unknown: idempotent no-op
    const commitTs = this.clock.tick();
    for (const w of record.writes) {
      this.appendVersion(w.key, { value: w.value, commitTs });
    }
    this.durablePrepare.delete(txnId);
    if (session) {
      session.writes.clear();
      session.state = "committed";
    } else {
      this.txns.set(txnId, {
        readTs: record.readTs,
        writes: new Map(),
        state: "committed",
      });
    }
  }

  /** Abort a prepared or open txn. Idempotent. */
  abortPrepared(txnId: TxnId): void {
    const session = this.txns.get(txnId);
    if (session) {
      if (session.state === "committed") return;
      session.writes.clear();
      session.state = "aborted";
    }
    this.durablePrepare.delete(txnId);
  }

  /**
   * Simulate crash: drop all in-memory txn session state EXCEPT durable
   * prepare log + committed version chains. Used by recovery tests.
   */
  crash(): void {
    this.txns.clear();
  }

  /** After crash, restore open/prepared bookkeeping from durable prepare log. */
  recover(): void {
    for (const [txnId, record] of this.durablePrepare) {
      this.txns.set(txnId, {
        readTs: record.readTs,
        writes: new Map(record.writes.map((w) => [w.key, w.value])),
        state: "prepared",
      });
    }
  }

  stateOf(txnId: TxnId): TxnState | undefined {
    const session = this.txns.get(txnId);
    if (session) return session.state;
    if (this.durablePrepare.has(txnId)) return "prepared";
    return undefined;
  }

  /** Test helper: committed versions for a key, oldest -> newest. */
  debugVersions(key: Key): Array<{ value: Value | null; commitTs: LogicalTime }> {
    return (this.versions.get(key) ?? []).map((v) => ({
      value: v.value,
      commitTs: v.commitTs,
    }));
  }

  private mustOpen(txnId: TxnId): TxnSession {
    const session = this.txns.get(txnId);
    if (!session) throw new Error(`unknown txn ${txnId} on shard ${this.shardId}`);
    if (session.state !== "open") {
      throw new Error(`txn ${txnId} is ${session.state}, not open`);
    }
    return session;
  }

  private checkWriteConflicts(txnId: TxnId, session: TxnSession): void {
    for (const key of session.writes.keys()) {
      const chain = this.versions.get(key);
      const latest = chain?.[chain.length - 1];
      if (latest && latest.commitTs > session.readTs) {
        session.writes.clear();
        session.state = "aborted";
        throw new Error(
          `ww conflict on key "${key}" for txn ${txnId}: aborting`,
        );
      }
    }
  }

  private appendVersion(key: Key, version: VersionedValue): void {
    let chain = this.versions.get(key);
    if (!chain) {
      chain = [];
      this.versions.set(key, chain);
    }
    chain.push(version);
  }
}
