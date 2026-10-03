import type { WriteOp } from "./types.js";

export type TxnState = { readEpoch: number; writes: Map<string, WriteOp> };

export class TxnBook {
  private txns = new Map<string, TxnState>();

  begin(txnId: string, readEpoch: number): void {
    this.txns.set(txnId, { readEpoch, writes: new Map() });
  }

  get(txnId: string): TxnState | undefined {
    return this.txns.get(txnId);
  }

  has(txnId: string): boolean {
    return this.txns.has(txnId);
  }

  abort(txnId: string): boolean {
    return this.txns.delete(txnId);
  }

  take(txnId: string): TxnState | undefined {
    const t = this.txns.get(txnId);
    if (t) this.txns.delete(txnId);
    return t;
  }
}
