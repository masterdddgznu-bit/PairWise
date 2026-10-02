import type { TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";

export function checkWriteWrite(_tx: TxRecord, _store: CommittedStore): string | undefined {
  return undefined;
}
