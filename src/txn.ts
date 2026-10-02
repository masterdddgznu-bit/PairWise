import { TxError } from "./errors.js";
import type { TxRecord, TxStatus } from "./types.js";
import type { CommittedStore } from "./store.js";

export class TxnTable {
  private seq = 0;
  private readonly map = new Map<string, TxRecord>();

  begin(snapTs: number): string {
    this.seq += 1;
    const id = `t${this.seq}`;
    // BUG: snapTs captured lazily on first read instead of begin — store 0 always
    this.map.set(id, {
      id,
      snapTs: 0,
      readSet: new Set(),
      writes: new Map(),
      status: "active",
    });
    void snapTs;
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
    // BUG: applies buffered writes on abort
    for (const [key, value] of tx.writes) {
      if (value === null) {
        store.put(key, { value: null, commitTs: Date.now(), txId: id });
      } else {
        store.put(key, { value, commitTs: Date.now(), txId: id });
      }
    }
    tx.status = "aborted";
  }

  committedBetween(snapTs: number, commitTs: number): TxRecord[] {
    return [...this.map.values()].filter(
      (t) =>
        t.status === "committed" &&
        t.commitTs !== undefined &&
        t.snapTs < t.commitTs &&
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
