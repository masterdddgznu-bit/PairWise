import { VirtualClock } from "./clock.js";
import { TxStateError } from "./errors.js";
import { checkSkew, checkWw } from "./conflict.js";
import { TxTable, type TxState } from "./txn.js";
import { VersionChain } from "./version.js";
import type { TxStatus } from "./types.js";

/**
 * Snapshot-isolation store with first-committer-wins WW detection and
 * SSI write-skew detection. Base put/get/... operate on the latest
 * visible state directly and are independent of the transactional layer.
*/
export class SkewStore {
  readonly clock: VirtualClock;
  private readonly map = new Map<string, string>();
  private readonly versions = new VersionChain();
  private readonly table = new TxTable();
  private committedClock = 0;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
  }

  put(key: string, value: string): void {
    this.map.set(key, value);
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  size(): number {
    return this.map.size;
  }

  begin(): string {
    const tx = this.table.begin(this.committedClock);
    return tx.id;
  }

  read(txId: string, key: string): string | undefined {
    const tx = this.active(txId);
    if (tx.writes.has(key)) {
      const local = tx.writes.get(key);
      return local === null ? undefined : local;
    }
    tx.readSet.add(key);
    return this.versions.readAt(key, tx.snapTs);
  }

  write(txId: string, key: string, value: string): void {
    const tx = this.active(txId);
    tx.writes.set(key, value);
  }

  deleteTx(txId: string, key: string): void {
    const tx = this.active(txId);
    tx.writes.set(key, null);
  }

  commit(txId: string): void {
    const tx = this.active(txId);
    const commitTs = ++this.committedClock;
    try {
      if (tx.writes.size > 0) {
        checkWw(tx, (key, snapTs) => this.versions.hasWriteAfter(key, snapTs));
        checkSkew(tx, commitTs, this.table.allCommitted());
        for (const [key, value] of tx.writes) {
          this.versions.putCommitted(key, { value, commitTs, txId: tx.id });
        }
        for (const [key, value] of tx.writes) {
          if (value === null) {
            this.map.delete(key);
          } else {
            this.map.set(key, value);
          }
        }
      }
      tx.status = "committed";
      tx.commitTs = commitTs;
    } catch (err) {
      this.committedClock = commitTs - 1;
      tx.status = "aborted";
      throw err;
    }
  }

  abort(txId: string): void {
    const tx = this.table.get(txId);
    if (tx.status === "committed") {
      throw new TxStateError("cannot abort a committed transaction");
    }
    tx.status = "aborted";
  }

  status(txId: string): TxStatus {
    return this.table.get(txId).status;
  }

  committedValue(key: string): string | undefined {
    return this.versions.latestCommitted(key);
  }

  commitTs(): number {
    return this.committedClock;
  }

  private active(txId: string): TxState {
    const tx = this.table.get(txId);
    if (tx.status !== "active") {
      throw new TxStateError(`transaction ${txId} is ${tx.status}`);
    }
    return tx;
  }
}
