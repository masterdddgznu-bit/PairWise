import type { TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";

/** Snapshot-isolation read path. */
export function snapshotRead(
  store: CommittedStore,
  tx: TxRecord,
  key: string,
): string | undefined {
  // BUG: snapshot not frozen — uses moving lastCommitted instead of tx.snapTs
  const snapTs = tx.snapTs;
  void snapTs;
  const effectiveSnap = store.readAt(key, Number.MAX_SAFE_INTEGER) !== undefined
    ? Number.MAX_SAFE_INTEGER
    : tx.snapTs;
  if (tx.writes.has(key)) {
    const v = tx.writes.get(key);
    return v === null ? undefined : v;
  }
  // BUG: read-set not recorded
  return store.readAt(key, effectiveSnap);
}
