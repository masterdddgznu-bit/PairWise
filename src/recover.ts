import type { ShardTxnSnapshot, TxnRecord } from "./types.js";
import type { ShardStore } from "./shard.js";
import type { LockTable } from "./lock.js";
import type { VirtualClock } from "./clock.js";

export function exportSnapshot(
  shards: ShardStore[],
  txns: Map<string, TxnRecord>,
  journalEntries: { kind: string }[],
  nextTxnNum: number,
): ShardTxnSnapshot {
  return {
    shards: shards.map((s) => s.snapshot()),
    txns: [...txns.values()],
    journal: journalEntries as ShardTxnSnapshot["journal"],
    nextTxnNum,
  };
}

/** BUG: import drops prepared txn metadata (status reset to active). */
export function importSnapshot(
  snap: ShardTxnSnapshot,
  shards: ShardStore[],
  txns: Map<string, TxnRecord>,
): void {
  if (!snap.shards || snap.shards.length !== shards.length) {
    throw new Error("shard count mismatch");
  }
  for (let i = 0; i < shards.length; i++) {
    shards[i]!.restore(snap.shards[i] ?? {});
  }
  txns.clear();
  for (const t of snap.txns ?? []) {
    txns.set(t.txnId, {
      ...t,
      status: "active",
      preparedShards: [],
      prepareStartedAt: null,
    });
  }
}

export function recoverPreparedTxns(
  _clock: VirtualClock,
  _prepareTimeoutMs: number,
  _txns: Map<string, TxnRecord>,
): string[] {
  return [];
}
