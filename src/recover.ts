import type { MvccSnapshot } from "./types.js";
import type { CommittedStore } from "./store.js";
import type { TxnTable } from "./txn.js";
import type { Journal } from "./journal.js";

export function exportSnapshot(
  store: CommittedStore,
  txns: TxnTable,
  journal: Journal,
  lastCommittedTs: number,
  ssi: boolean,
): MvccSnapshot {
  return {
    lastCommittedTs,
    versions: store.snapshot(),
    txns: txns.all().map((t) => ({
      ...t,
      readSet: new Set(t.readSet),
      writes: new Map(t.writes),
    })),
    journal: journal.snapshot(),
    ssi,
  };
}

export function importSnapshot(
  snap: MvccSnapshot,
  store: CommittedStore,
  txns: TxnTable,
  journal: Journal,
): number {
  store.restore(snap.versions);
  txns.restore(snap.txns);
  journal.restore(snap.journal);
  return snap.lastCommittedTs;
}
