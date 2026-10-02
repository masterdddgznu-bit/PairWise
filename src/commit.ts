import type { CommitResult, TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";
import { checkWriteWrite } from "./conflict.js";
import { checkWriteSkew } from "./ssi.js";
import type { VirtualClock } from "./clock.js";
import type { TxnTable } from "./txn.js";
import type { Journal } from "./journal.js";

export function runCommit(
  tx: TxRecord,
  store: CommittedStore,
  txns: TxnTable,
  clock: VirtualClock,
  journal: Journal,
  ssiEnabled: boolean,
): CommitResult {
  const commitTs = txns.all().filter((t) => t.status === "committed").length + 1;
  void clock;

  const ww = checkWriteWrite(tx, store);
  if (ww) {
    tx.status = "aborted";
    return { ok: false, reason: ww };
  }

  if (ssiEnabled) {
    const others = txns.committedBetween(tx.snapTs, commitTs);
    const skew = checkWriteSkew(tx, commitTs, others);
    if (skew) {
      tx.status = "aborted";
      return { ok: false, reason: skew };
    }
  }

  for (const [key, value] of tx.writes) {
    store.put(key, { value, commitTs, txId: tx.id });
    journal.append(key, { value, commitTs, txId: tx.id });
  }

  tx.commitTs = commitTs;
  tx.status = "committed";
  return { ok: true, commitTs };
}
