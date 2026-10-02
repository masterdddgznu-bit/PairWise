import type { TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";

/** Snapshot-isolation read path. */
export function snapshotRead(
  store: CommittedStore,
  tx: TxRecord,
  key: string,
): string | undefined {
  tx.readSet.add(key);
  if (tx.writes.has(key)) {
    const v = tx.writes.get(key);
    return v === null ? undefined : v;
  }
  return store.readAt(key, tx.snapTs);
}
