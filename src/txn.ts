import { TxError } from "./errors.js";
import type { TxRecord, TxStatus } from "./types.js";

export class TxnTable {
  private seq = 0;
  private readonly map = new Map<string, TxRecord>();

  begin(snapTs: number): string {
    this.seq += 1;
    const id = `t${this.seq}`;
    this.map.set(id, {
      id,
      snapTs,
      readSet: new Set(),
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
    if (tx.status !== "active") throw new TxError(tx.status);
    return tx;
  }

  abort(id: string): void {
    const tx = this.get(id);
    if (tx.status === "committed") throw new TxError("committed");
    tx.writes.clear();
    tx.status = "aborted";
  }

  committedBetween(snapTs: number, commitTs: number): TxRecord[] {
    return [...this.map.values()].filter(
      (t) =>
        t.status === "committed" &&
        t.commitTs !== undefined &&
        t.commitTs > snapTs &&
        t.commitTs < commitTs,
    );
  }

  all(): TxRecord[] {
    return [...this.map.values()];
  }

  status(id: string): TxStatus {
    return this.get(id).status;
  }

  restore(records: TxRecord[]): void {
    this.map.clear();
    this.seq = 0;
    for (const r of records) {
      const copy: TxRecord = {
        id: r.id,
        snapTs: r.snapTs,
        readSet: new Set(r.readSet),
        writes: new Map(r.writes),
        status: r.status,
        commitTs: r.commitTs,
      };
      this.map.set(copy.id, copy);
      const n = Number(copy.id.slice(1));
      if (!Number.isNaN(n) && n > this.seq) this.seq = n;
    }
  }
}
