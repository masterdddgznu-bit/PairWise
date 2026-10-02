import type { TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";

/** Write-write conflict detection. BUG: missing check entirely. */
export function checkWriteWrite(_tx: TxRecord, _store: CommittedStore): string | undefined {
  return undefined;
}
