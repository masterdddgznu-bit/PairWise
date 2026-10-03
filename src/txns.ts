import type { WriteOp } from "./types.js";

export class TxnBook {
  private txns = new Map<string, { readEpoch: number; writes: Map<string, WriteOp> }>();

  begin(txnId: string, readEpoch: number): void {
    this.txns.set(txnId, { readEpoch, writes: new Map() });
  }

  get(txnId: string): { readEpoch: number; writes: Map<string, WriteOp> } | undefined {
    return this.txns.get(txnId);
  }

  abort(txnId: string): boolean {
    return this.txns.delete(txnId);
  }

  take(txnId: string): { readEpoch: number; writes: Map<string, WriteOp> } | undefined {
    const txn = this.txns.get(txnId);
    if (txn) this.txns.delete(txnId);
    return txn;
  }
}
