import type { ShardTxnSnapshot, TxnRecord } from "./types.js";
import type { ShardStore } from "./shard.js";
import type { VirtualClock } from "./clock.js";
import { isPrepareTimedOut } from "./prepare.js";

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
      txnId: t.txnId,
      status: t.status,
      writes: { ...t.writes },
      expectedVersions: { ...t.expectedVersions },
      prepareStartedAt: t.prepareStartedAt,
      preparedShards: [...(t.preparedShards ?? [])],
    });
  }
}

export function recoverPreparedTxns(
  clock: VirtualClock,
  prepareTimeoutMs: number,
  txns: Map<string, TxnRecord>,
): string[] {
  const finished: string[] = [];
  const now = clock.now();
  for (const txn of txns.values()) {
    if (txn.status !== "prepared") continue;
    const started = txn.prepareStartedAt ?? now;
    if (isPrepareTimedOut(started, now, prepareTimeoutMs)) {
      txn.status = "aborted";
    } else {
      txn.status = "committed";
    }
    finished.push(txn.txnId);
  }
  return finished;
}
