import type { TxRecord } from "./types.js";

/**
 * SSI write-skew via rw anti-dependencies.
 * Test-locked: for committed C with snapTs < C.commitTs < commitTs,
 * if readSet(tx)∩writeSet(C)≠∅ AND writeSet(tx)∩readSet(C)≠∅ → conflict.
 * BUG: always reports skew when ssi path entered.
 */
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
