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
  private readonly txns = new Map<string, TxState>();
  private seq = 0;

  begin(snapTs: number): TxState {
    this.seq += 1;
    const id = `t${this.seq}`;
    const tx: TxState = {
      id,
      snapTs,
      readSet: new Set<string>(),
      writes: new Map<string, string | null>(),
      status: "active",
    };
    this.txns.set(id, tx);
    return tx;
  }

  get(txId: string): TxState {
    const tx = this.txns.get(txId);
    if (!tx) {
      throw new TxStateError(`unknown transaction: ${txId}`);
    }
    return tx;
  }

  allCommitted(): TxState[] {
    const committed: TxState[] = [];
    for (const tx of this.txns.values()) {
      if (tx.status === "committed") {
        committed.push(tx);
      }
    }
    return committed;
  }
}
