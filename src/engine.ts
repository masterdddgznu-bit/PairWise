import { VirtualClock } from "./clock.js";
import type { CommitResult, OccOptions, OccSnapshot } from "./types.js";
import { CommittedStore } from "./store.js";
import { TxnTable } from "./txn.js";
import { occRead } from "./snapshot.js";
import { runCommit } from "./commit.js";
import { Journal } from "./journal.js";
import { exportSnapshot, importSnapshot } from "./recover.js";

export class OccStore {
  readonly clock: VirtualClock;
  private readonly store = new CommittedStore();
  private readonly txns = new TxnTable();
  private readonly journal = new Journal();
  private readonly validateReads: boolean;
  private lastCommittedTs = 0;

  constructor(clock?: VirtualClock, opts?: OccOptions) {
    this.clock = clock ?? new VirtualClock();
    this.validateReads = opts?.validateReads === true;
  }

  begin(): string {
    return this.txns.begin(this.lastCommittedTs);
  }

  read(txId: string, key: string): string | undefined {
    const tx = this.txns.requireActive(txId);
    return occRead(this.store, tx, key);
  }

  write(txId: string, key: string, value: string): void {
    const tx = this.txns.requireActive(txId);
    tx.writes.set(key, value);
  }

  delete(txId: string, key: string): void {
    const tx = this.txns.requireActive(txId);
    tx.writes.set(key, null);
  }

  commit(txId: string): CommitResult {
    const tx = this.txns.requireActive(txId);
    const result = runCommit(
      tx,
      this.store,
      this.txns,
      this.clock,
      this.journal,
      this.validateReads,
    );
    if (result.ok) this.lastCommittedTs = result.commitTs;
    return result;
  }

  abort(txId: string): void {
    this.txns.abort(txId, this.store);
  }

  get(key: string): string | undefined {
    const list = this.store.snapshot()[key];
    if (!list || list.length === 0) return undefined;
    const head = list[0]!;
    return head.value === null ? undefined : head.value;
  }

  lastCommitTs(): number {
    return this.lastCommittedTs;
  }

  status(txId: string): string {
    return this.txns.status(txId);
  }

  exportState(): OccSnapshot {
    return exportSnapshot(
      this.store,
      this.txns,
      this.journal,
      this.lastCommittedTs,
      this.validateReads,
    );
  }

  importState(state: OccSnapshot): void {
    this.lastCommittedTs = importSnapshot(
      state,
      this.store,
      this.txns,
      this.journal,
    );
    this.journal.replay(this.store);
  }

  /** test helper — committed latest visible value */
  committedRead(key: string): string | undefined {
    return this.store.latest(key);
  }
}
