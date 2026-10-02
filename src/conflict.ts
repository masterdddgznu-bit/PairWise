import type { TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";

export function checkWriteWrite(tx: TxRecord, store: CommittedStore): string | undefined {
  for (const key of tx.writes.keys()) {
    if (store.writeAfter(key, tx.snapTs)) return "ww";
  }
  return undefined;
}
