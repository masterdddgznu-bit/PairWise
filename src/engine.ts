import { VirtualClock } from "./clock.js";
import { TxError } from "./errors.js";
import type { CommitResult, MvccSsiOptions, MvccSnapshot } from "./types.js";
import { CommittedStore } from "./store.js";
import { TxnTable } from "./txn.js";
import { snapshotRead } from "./snapshot.js";
import { runCommit } from "./commit.js";
import { Journal } from "./journal.js";
import { exportSnapshot, importSnapshot } from "./recover.js";

export class MvccSsi {
  readonly clock: VirtualClock;
  private readonly store = new CommittedStore();
  private readonly txns = new TxnTable();
  private readonly journal = new Journal();
  private readonly ssi: boolean;
  private lastCommittedTs = 0;

  constructor(clock?: VirtualClock, opts?: MvccSsiOptions) {
    this.clock = clock ?? new VirtualClock();
    this.ssi = opts?.ssi !== false;
  }

  begin(): string {
    return this.txns.begin(this.lastCommittedTs);
  }

  read(txnId: string, key: string): string | undefined {
    const tx = this.txns.requireActive(txnId);
    return snapshotRead(this.store, tx, key);
  }

  write(txnId: string, key: string, value: string): void {
    const tx = this.txns.requireActive(txnId);
    tx.writes.set(key, value);
  }

  delete(txnId: string, key: string): void {
    const tx = this.txns.requireActive(txnId);
    tx.writes.set(key, null);
  }

  commit(txnId: string): CommitResult {
    const tx = this.txns.requireActive(txnId);
    const result = runCommit(
      tx,
      this.store,
      this.txns,
      this.clock,
      this.journal,
      this.ssi,
    );
    if (result.ok) this.lastCommittedTs = result.commitTs;
    return result;
  }

  abort(txnId: string): void {
    this.txns.abort(txnId, this.store);
  }

  /** BUG: returns first chain head ignoring visibility / tombstones. */
  get(key: string): string | undefined {
    const list = this.store.snapshot()[key];
    if (!list || list.length === 0) return undefined;
    return list[0]!.value === null ? undefined : list[0]!.value;
  }

  lastCommitTs(): number {
    return this.lastCommittedTs;
  }

  status(txnId: string): string {
    return this.txns.status(txnId);
  }

  exportState(): MvccSnapshot {
    return exportSnapshot(
      this.store,
      this.txns,
      this.journal,
      this.lastCommittedTs,
      this.ssi,
    );
  }

  importState(state: MvccSnapshot): void {
    this.lastCommittedTs = importSnapshot(state, this.store, this.txns, this.journal);
    this.journal.replay(this.store);
  }

  /** test helper */
  committedRead(key: string): string | undefined {
    return this.store.latest(key);
  }
}
