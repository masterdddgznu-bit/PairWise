import type { TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";

/** OCC read path: committed visibility + local write buffer. */
export function occRead(
  store: CommittedStore,
  tx: TxRecord,
  key: string,
): string | undefined {
  tx.readSet.add(key);
  if (tx.writes.has(key)) {
    const v = tx.writes.get(key);
    return v === null ? undefined : v;
  }
  return store.readAt(key, tx.startTs);
}
