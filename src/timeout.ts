import type { WaitQueue } from "./waiters.js";
import type { TxnTable } from "./txn.js";
import type { LockTable } from "./locktable.js";
import { clearNode } from "./waitfor.js";

/** Process expired waiters. BUG: does not abort / release. */
export function processTimeouts(
  now: number,
  waiters: WaitQueue,
  _txns: TxnTable,
  _locks: LockTable,
  waitsFor: Map<string, Set<string>>,
  _promote: (key: string) => void,
): void {
  const expired = waiters.removeExpired(now);
  for (const w of expired) {
    clearNode(waitsFor, w.txId);
  }
}
