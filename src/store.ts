import { VirtualClock } from "./clock.js";
import type { TxStatus } from "./types.js";
import { TxStateError } from "./errors.js";
import { TxTable, type TxState } from "./txn.js";
import { VersionChain } from "./version.js";
import { checkSkew, checkWw } from "./conflict.js";

/**
 * Snapshot-isolation store with SSI write-skew detection (feature incomplete).
 * Base put/get/delete/has/keys/size work.
 */
export class SkewStore {
  readonly clock: VirtualClock;
  private readonly map = new Map<string, string>();
  private readonly txs = new TxTable();
  private readonly versions = new VersionChain();
  private clockTs = 0;

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
    return this.txs.begin(this.clockTs).id;
  }

  read(tx: string, key: string): string | undefined {
    const state = this.active(tx);
    state.readSet.add(key);
    if (state.writes.has(key)) {
      const value = state.writes.get(key);
      return value === null ? undefined : value;
    }
    return this.versions.readAt(key, state.snapTs);
  }

  write(tx: string, key: string, value: string): void {
    const state = this.active(tx);
    state.writes.set(key, value);
  }

  deleteTx(tx: string, key: string): void {
    const state = this.active(tx);
    state.writes.set(key, null);
  }

  commit(tx: string): void {
    const state = this.active(tx);
    const commitTs = ++this.clockTs;
    if (state.writes.size === 0) {
      state.status = "committed";
      state.commitTs = commitTs;
      return;
    }
    try {
      checkWw(state, (key, snapTs) => this.versions.hasWriteAfter(key, snapTs));
      checkSkew(state, commitTs, this.txs.allCommitted());
    } catch (err) {
      state.status = "aborted";
      throw err;
    }
    for (const [key, value] of state.writes) {
      this.versions.putCommitted(key, { value, commitTs, txId: state.id });
    }
    state.status = "committed";
    state.commitTs = commitTs;
  }

  abort(tx: string): void {
    const state = this.txs.get(tx);
    if (state.status === "committed") {
      throw new TxStateError(`transaction ${tx} already committed`);
    }
    state.status = "aborted";
  }

  status(tx: string): TxStatus {
    return this.txs.get(tx).status;
  }

  committedValue(key: string): string | undefined {
    return this.versions.latestCommitted(key);
  }

  commitTs(): number {
    return this.clockTs;
  }

  private active(tx: string): TxState {
    const state = this.txs.get(tx);
    if (state.status !== "active") {
      throw new TxStateError(`transaction ${tx} is ${state.status}`);
    }
    return state;
  }
}
