import type { OccSnapshot, TxRecord } from "./types.js";
import type { CommittedStore } from "./store.js";
import type { TxnTable } from "./txn.js";
import type { Journal } from "./journal.js";

function serializeTxn(t: TxRecord): TxRecord {
  return {
    ...t,
    readSet: new Set(t.readSet),
    writes: new Map(t.writes),
  };
}

export function exportSnapshot(
  store: CommittedStore,
  txns: TxnTable,
  journal: Journal,
  lastCommittedTs: number,
  validateReads: boolean,
): OccSnapshot {
  return {
    lastCommittedTs,
    versions: store.snapshot(),
    txns: txns.all().map(serializeTxn),
    journal: journal.snapshot(),
    validateReads,
  };
}

export function importSnapshot(
  snap: OccSnapshot,
  store: CommittedStore,
  txns: TxnTable,
  journal: Journal,
): number {
  store.restore({});
  txns.restore([]);
  journal.restore([]);
  void snap;
  return 0;
}
