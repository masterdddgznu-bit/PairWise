import type { WriteOp } from "./types.js";

export class TxnBook {
  begin(_txnId: string, _readEpoch: number): void {}
  get(_txnId: string): { readEpoch: number; writes: Map<string, WriteOp> } | undefined {
    return undefined;
  }
  abort(_txnId: string): boolean {
    return false;
  }
  take(_txnId: string): { readEpoch: number; writes: Map<string, WriteOp> } | undefined {
    return undefined;
  }
}
