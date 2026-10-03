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

export class Journal {
  private records = new Map<string, JournalRecord>();

  upsert(rec: JournalRecord): void {
    this.records.set(rec.txnId, {
      ...rec,
      participants: [...rec.participants],
      keys: Object.fromEntries(
        Object.entries(rec.keys).map(([pid, keys]) => [pid, [...keys]]),
      ),
    });
  }

  get(txnId: string): JournalRecord | undefined {
    return this.records.get(txnId);
  }

  remove(txnId: string): void {
    this.records.delete(txnId);
  }

  all(): JournalRecord[] {
    return [...this.records.values()];
  }

  exportAll(): JournalRecord[] {
    return this.all().map((rec) => ({
      ...rec,
      participants: [...rec.participants],
      keys: Object.fromEntries(
        Object.entries(rec.keys).map(([pid, keys]) => [pid, [...keys]]),
      ),
    }));
  }

  importAll(recs: JournalRecord[]): void {
    this.records.clear();
    for (const rec of recs) this.upsert(rec);
  }
}
