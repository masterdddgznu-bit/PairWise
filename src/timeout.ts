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
  const touched = new Set<string>();
  const done = new Set<string>();
  for (const w of expired) {
    if (done.has(w.txId)) continue;
    done.add(w.txId);
    clearNode(waitsFor, w.txId);
    const tx = txns.get(w.txId);
    if (tx.status === "active" || tx.status === "waiting") {
      tx.writes.clear();
      txns.setStatus(w.txId, "aborted");
    }
    for (const key of locks.removeAll(w.txId)) touched.add(key);
    touched.add(w.key);
  }
  for (const key of touched) promote(key);
}
