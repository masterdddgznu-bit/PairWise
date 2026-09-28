import type { TxStatus } from "./types.js";

export type TxState = {
  id: string;
  snapTs: number;
  readSet: Set<string>;
  writes: Map<string, string | null>;
  status: TxStatus;
  commitTs?: number;
};

export class TxTable {
  begin(_snapTs: number): TxState {
    throw new Error("begin not implemented");
  }

  get(_txId: string): TxState {
    throw new Error("txn get not implemented");
  }

  allCommitted(): TxState[] {
    return [];
  }
}
