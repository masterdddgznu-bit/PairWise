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
  const ww = checkWriteWrite(tx, store);
  if (ww) {
    tx.status = "aborted";
    return { ok: false, reason: ww };
  }

  const commitTs = clock.tick();

  if (ssiEnabled) {
    const others = txns.committedBetween(tx.snapTs, commitTs);
    const skew = checkWriteSkew(tx, commitTs, others);
    if (skew) {
      tx.status = "aborted";
      return { ok: false, reason: skew };
    }
  }

  for (const [key, value] of tx.writes) {
    const entry = { value, commitTs, txId: tx.id };
    store.put(key, entry);
    journal.append(key, entry);
  }

  tx.commitTs = commitTs;
  tx.status = "committed";
  return { ok: true, commitTs };
}
