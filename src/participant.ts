import type { LocalPhase } from "./types.js";

type LocalTxn = { phase: LocalPhase; keys: Set<string> };

export type ParticipantState = {
  hang: boolean;
  txns: Record<string, { phase: LocalPhase; keys: string[] }>;
};

export class Participant {
  private hang = false;
  private txns = new Map<string, LocalTxn>();

  constructor(readonly id: string) {}

  setHang(hang: boolean): void {
    this.hang = hang;
  }

  isHung(): boolean {
    return this.hang;
  }

  prepare(txnId: string, keys: string[]): boolean {
    const existing = this.txns.get(txnId);
    if (existing && existing.phase === "prepared") {
      for (const key of keys) existing.keys.add(key);
      return true;
    }
    if (existing && (existing.phase === "committed" || existing.phase === "aborted")) {
      return false;
    }
    this.txns.set(txnId, { phase: "prepared", keys: new Set(keys) });
    return true;
  }

  commit(txnId: string): boolean {
    if (this.hang) return false;
    const txn = this.txns.get(txnId);
    if (txn) txn.phase = "committed";
    else this.txns.set(txnId, { phase: "committed", keys: new Set() });
    return true;
  }

  abort(txnId: string): void {
    const txn = this.txns.get(txnId);
    if (txn) {
      if (txn.phase !== "committed") txn.phase = "aborted";
    } else {
      this.txns.set(txnId, { phase: "aborted", keys: new Set() });
    }
  }

  localPhase(txnId: string): LocalPhase {
    return this.txns.get(txnId)?.phase ?? "none";
  }

  enlistedKeys(txnId: string): string[] {
    const txn = this.txns.get(txnId);
    if (!txn) return [];
    return [...txn.keys].sort();
  }

  exportState(): ParticipantState {
    const txns: ParticipantState["txns"] = {};
    for (const [txnId, txn] of this.txns) {
      txns[txnId] = { phase: txn.phase, keys: [...txn.keys].sort() };
    }
    return { hang: this.hang, txns };
  }

  importState(state: ParticipantState): void {
    this.hang = state.hang;
    this.txns.clear();
    for (const [txnId, txn] of Object.entries(state.txns)) {
      this.txns.set(txnId, { phase: txn.phase, keys: new Set(txn.keys) });
    }
  }
}
