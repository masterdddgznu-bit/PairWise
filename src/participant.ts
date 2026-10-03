import type { LocalPhase } from "./types.js";
import { LockTable } from "./locks.js";

export type ParticipantTxnSnapshot = {
  txnId: string;
  phase: LocalPhase;
  keys: string[];
};

export type ParticipantSnapshot = {
  id: string;
  hang: boolean;
  txns: ParticipantTxnSnapshot[];
};

type LocalRec = {
  phase: LocalPhase;
  keys: Set<string>;
};

export class Participant {
  private hung = false;
  private txns = new Map<string, LocalRec>();

  constructor(
    readonly id: string,
    private readonly locks: LockTable = new LockTable(),
  ) {}

  setHang(hang: boolean): void {
    this.hung = hang;
  }

  isHung(): boolean {
    return this.hung;
  }

  prepare(txnId: string, keys: string[]): boolean {
    const rec = this.txns.get(txnId);
    if (rec) {
      if (rec.phase !== "prepared") return false;
      const fresh = keys.filter((k) => !rec.keys.has(k));
      if (fresh.length > 0 && !this.locks.tryLock(this.id, txnId, fresh)) {
        return false;
      }
      for (const k of fresh) rec.keys.add(k);
      return true;
    }
    const uniq = [...new Set(keys)];
    if (!this.locks.tryLock(this.id, txnId, uniq)) return false;
    this.txns.set(txnId, { phase: "prepared", keys: new Set(uniq) });
    return true;
  }

  commit(txnId: string): boolean {
    if (this.hung) return false;
    const rec = this.txns.get(txnId);
    if (!rec) return true;
    if (rec.phase === "committed") return true;
    if (rec.phase !== "prepared") return false;
    this.locks.releaseTxn(this.id, txnId);
    rec.phase = "committed";
    return true;
  }

  abort(txnId: string): void {
    const rec = this.txns.get(txnId);
    if (!rec) {
      this.txns.set(txnId, { phase: "aborted", keys: new Set() });
      return;
    }
    if (rec.phase === "committed") return;
    this.locks.releaseTxn(this.id, txnId);
    rec.phase = "aborted";
  }

  localPhase(txnId: string): LocalPhase {
    return this.txns.get(txnId)?.phase ?? "none";
  }

  enlistedKeys(txnId: string): string[] {
    const rec = this.txns.get(txnId);
    return rec ? [...rec.keys].sort() : [];
  }

  snapshot(): ParticipantSnapshot {
    return {
      id: this.id,
      hang: this.hung,
      txns: [...this.txns.entries()].map(([txnId, rec]) => ({
        txnId,
        phase: rec.phase,
        keys: [...rec.keys].sort(),
      })),
    };
  }

  restore(txns: ParticipantTxnSnapshot[]): void {
    this.txns.clear();
    for (const t of txns) {
      const keys = new Set(t.keys);
      this.txns.set(t.txnId, { phase: t.phase, keys });
      if (t.phase === "prepared") {
        this.locks.tryLock(this.id, t.txnId, [...keys]);
      }
    }
  }
}
