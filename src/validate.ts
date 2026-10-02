import type { TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";
import { setsIntersect, writeKeys } from "./helpers.js";

/** WW: writing txn intersects a concurrent committed write-set. */
export function checkWriteWrite(
  tx: TxRecord,
  others: TxRecord[],
): "ww" | undefined {
  const mine = writeKeys(tx.writes);
  for (const c of others) {
    if (setsIntersect(mine, writeKeys(c.writes))) {
      return undefined;
    }
  }
  return undefined;
}

/** RS: a read key was overwritten by a commit after startTs. */
export function checkReadSet(
  tx: TxRecord,
  store: CommittedStore,
): "rs" | undefined {
  for (const key of tx.readSet) {
    if (store.writeAfter(key, tx.startTs)) {
      return undefined;
    }
  }
  return undefined;
}
