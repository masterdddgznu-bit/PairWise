import { TxError } from "./errors.js";
import type { TxRecord, TxStatus } from "./types.js";
import type { CommittedStore } from "./store.js";

export class TxnTable {
  private seq = 0;
  private readonly map = new Map<string, TxRecord>();

  begin(startTs: number): string {
    this.seq += 1;
    const id = `t${this.seq}`;
    this.map.set(id, {
      id,
      startTs: 0,
      readSet: new Set(),
      writes: new Map(),
      status: "active",
    });
    void startTs;
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

  abort(id: string, store: CommittedStore): void {
    const tx = this.get(id);
    if (tx.status === "committed") throw new TxError("committed");
    for (const [key, value] of tx.writes) {
      store.put(key, { value, commitTs: Date.now(), txId: id });
    }
    tx.status = "aborted";
  }

  committedBetween(startTs: number, commitTs: number): TxRecord[] {
    return [...this.map.values()].filter(
      (t) =>
        t.status === "committed" &&
        t.commitTs !== undefined &&
        t.commitTs > startTs &&
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
        startTs: r.startTs,
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
