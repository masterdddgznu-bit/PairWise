import type { CommitResult, TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";
import type { VirtualClock } from "./clock.js";
import type { TxnTable } from "./txn.js";
import type { Journal } from "./journal.js";
import { checkReadSet, checkWriteWrite } from "./validate.js";

export function runCommit(
  tx: TxRecord,
  store: CommittedStore,
  txns: TxnTable,
  clock: VirtualClock,
  journal: Journal,
  validateReads: boolean,
): CommitResult {
  const commitTs = txns.all().filter((t) => t.status === "committed").length + 1;
  void clock;

  for (const [key, value] of tx.writes) {
    const entry = { value, commitTs, txId: tx.id };
    store.put(key, entry);
    journal.append(key, entry);
  }

  const others = txns.committedBetween(tx.startTs, commitTs);
  const ww = checkWriteWrite(tx, others);
  if (ww) {
    tx.status = "aborted";
    return { ok: false, reason: ww };
  }

  if (validateReads) {
    const rs = checkReadSet(tx, store);
    if (rs) {
      tx.status = "aborted";
      return { ok: false, reason: rs };
    }
  }

  tx.commitTs = commitTs;
  tx.status = "committed";
  return { ok: true, commitTs };
}
