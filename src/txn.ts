import { TxError } from "./errors.js";
import type { TxStatus } from "./types.js";

export type TxRecord = {
  id: string;
  reads: Set<string>;
  writes: Map<string, string | null>;
  status: TxStatus;
};

export class TxnTable {
  private seq = 0;
  private readonly map = new Map<string, TxRecord>();

  begin(): string {
    this.seq += 1;
    const id = `t${this.seq}`;
    this.map.set(id, {
      id,
      reads: new Set(),
      writes: new Map(),
      status: "active",
    });
    return id;
  }

  get(id: string): TxRecord {
    const tx = this.map.get(id);
    if (!tx) throw new TxError(`unknown txn ${id}`);
    return tx;
  }

  requireActive(id: string): TxRecord {
    const tx = this.get(id);
    if (tx.status !== "active" && tx.status !== "waiting") {
      throw new TxError(tx.status);
    }
    if (tx.status === "waiting") throw new TxError("waiting");
    return tx;
  }

  status(id: string): TxStatus {
    return this.get(id).status;
  }

  setStatus(id: string, status: TxStatus): void {
    this.get(id).status = status;
  }
}
