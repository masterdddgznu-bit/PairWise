import type { WaitQueue } from "./waiters.js";
import type { TxnTable } from "./txn.js";
import type { LockTable } from "./locktable.js";
import { clearNode } from "./waitfor.js";

export function processTimeouts(
  now: number,
  waiters: WaitQueue,
  txns: TxnTable,
  locks: LockTable,
  waitsFor: Map<string, Set<string>>,
  promote: (key: string) => void,
): void {
  const expired = waiters.removeExpired(now);
  for (const w of expired) {
    const tx = txns.get(w.txId);
    if (tx.status !== "active" && tx.status !== "waiting") continue;
    tx.writes.clear();
    const touched = new Set<string>([
      ...locks.removeAll(w.txId),
      ...waiters.removeTx(w.txId),
    ]);
    clearNode(waitsFor, w.txId);
    txns.setStatus(w.txId, "aborted");
    for (const key of touched) promote(key);
  }
}
