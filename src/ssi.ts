import type { TxRecord } from "./types.js";

export function checkWriteSkew(tx: TxRecord, commitTs: number, others: TxRecord[]): string | undefined {
  for (const c of others) {
    if (c.commitTs === undefined) continue;
    if (!(tx.snapTs < c.commitTs && c.commitTs < commitTs)) continue;
    const rw = [...tx.readSet].some((k) => c.writes.has(k));
    const wr = [...c.readSet].some((k) => tx.writes.has(k));
    if (rw || wr) return "ssi";
  }
  return undefined;
}
