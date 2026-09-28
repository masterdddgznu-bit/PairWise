import type { TxStatus } from "./types.js";
import { TxStateError } from "./errors.js";

export type TxState = {
  id: string;
  snapTs: number;
  readSet: Set<string>;
  writes: Map<string, string | null>;
  status: TxStatus;
  commitTs?: number;
};

export class TxTable {
  private readonly txs = new Map<string, TxState>();
  private counter = 0;

  begin(_snapTs: number): TxState {
    const id = `t${++this.counter}`;
    const tx: TxState = {
      id,
      snapTs: _snapTs,
      readSet: new Set<string>(),
      writes: new Map<string, string | null>(),
      status: "active",
    };
    this.txs.set(id, tx);
    return tx;
  }

  get(_txId: string): TxState {
    const tx = this.txs.get(_txId);
    if (!tx) {
      throw new TxStateError(`unknown transaction: ${_txId}`);
    }
    return tx;
  }

  allCommitted(): TxState[] {
    return [...this.txs.values()].filter((tx) => tx.status === "committed");
  }
}
