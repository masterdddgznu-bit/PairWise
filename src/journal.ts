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
  upsert(_rec: JournalRecord): void {}
  get(_txnId: string): JournalRecord | undefined {
    return undefined;
  }
  remove(_txnId: string): void {}
  all(): JournalRecord[] {
    return [];
  }
  exportAll(): JournalRecord[] {
    return [];
  }
  importAll(_recs: JournalRecord[]): void {}
}
