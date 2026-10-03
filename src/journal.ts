import type { JournalDecision, TxnPhase } from "./types.js";

export type JournalRecord = {
  txnId: string;
  phase: TxnPhase;
  participants: string[];
  keys: Record<string, string[]>;
  decision: JournalDecision;
  prepareDeadline: number | null;
  commitDeadline: number | null;
};

function copyRecord(rec: JournalRecord): JournalRecord {
  const keys: Record<string, string[]> = {};
  for (const [pid, ks] of Object.entries(rec.keys)) keys[pid] = [...ks];
  return {
    txnId: rec.txnId,
    phase: rec.phase,
    participants: [...rec.participants],
    keys,
    decision: rec.decision,
    prepareDeadline: rec.prepareDeadline,
    commitDeadline: rec.commitDeadline,
  };
}

export class Journal {
  private recs = new Map<string, JournalRecord>();

  upsert(rec: JournalRecord): void {
    this.recs.set(rec.txnId, copyRecord(rec));
  }
  get(txnId: string): JournalRecord | undefined {
    const rec = this.recs.get(txnId);
    return rec ? copyRecord(rec) : undefined;
  }
  remove(txnId: string): void {
    this.recs.delete(txnId);
  }
  all(): JournalRecord[] {
    return [...this.recs.values()].map(copyRecord);
  }
  exportAll(): JournalRecord[] {
    return this.all();
  }
  importAll(recs: JournalRecord[]): void {
    this.recs.clear();
    for (const rec of recs) this.recs.set(rec.txnId, copyRecord(rec));
  }
}
