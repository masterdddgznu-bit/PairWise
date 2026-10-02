import { VirtualClock } from "./clock.js";
import { covers } from "./compat.js";
import { assertNoDeadlock } from "./deadlock.js";
import { LockTimeoutError, TxError } from "./errors.js";
import { LockTable } from "./locktable.js";
import { CommittedStore } from "./store.js";
import { processTimeouts } from "./timeout.js";
import { TxnTable } from "./txn.js";
import type { LockMode, TwoPlOptions } from "./types.js";
import { tryUpgrade } from "./upgrade.js";
import { addEdges, clearNode } from "./waitfor.js";
import { WaitQueue } from "./waiters.js";

export class TwoPl {
  readonly clock: VirtualClock;
  private readonly store = new CommittedStore();
  private readonly txns = new TxnTable();
  private readonly locks = new LockTable();
  private readonly waiters = new WaitQueue();
  private readonly waitsFor = new Map<string, Set<string>>();
  private readonly deadlock: boolean;
  private readonly lockTimeoutMs: number;

  constructor(clock?: VirtualClock, opts?: TwoPlOptions) {
    this.clock = clock ?? new VirtualClock();
    this.deadlock = opts?.deadlock !== false;
    this.lockTimeoutMs = opts?.lockTimeoutMs ?? 0;
  }

  begin(): string {
    return this.txns.begin();
  }

  read(txId: string, key: string): string | undefined {
    const tx = this.txns.requireActive(txId);
    this.acquire(txId, key, "S");
    tx.reads.add(key);
    if (tx.writes.has(key)) {
      const v = tx.writes.get(key);
      return v === null ? undefined : v;
    }
    return this.store.get(key);
  }

  write(txId: string, key: string, value: string): void {
    const tx = this.txns.requireActive(txId);
    this.acquire(txId, key, "X");
    tx.writes.set(key, value);
  }

  delete(txId: string, key: string): void {
    const tx = this.txns.requireActive(txId);
    this.acquire(txId, key, "X");
    tx.writes.set(key, null);
  }

  commit(txId: string): void {
    const tx = this.txns.get(txId);
    if (tx.status === "committed") throw new TxError("committed");
    if (tx.status === "aborted") throw new TxError("aborted");
    this.store.apply(tx.writes);
    tx.writes.clear();
    this.releaseAll(txId);
    tx.status = "committed";
  }

  abort(txId: string): void {
    const tx = this.txns.get(txId);
    if (tx.status === "committed") throw new TxError("committed");
    tx.writes.clear();
    this.releaseAll(txId);
    tx.status = "aborted";
  }

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  status(txId: string): string {
    return this.txns.status(txId);
  }

  tick(): void {
    this.clock.tick();
    processTimeouts(
      this.clock.now(),
      this.waiters,
      this.txns,
      this.locks,
      this.waitsFor,
      (key) => this.promote(key),
    );
  }

  private acquire(txId: string, key: string, mode: LockMode): void {
    const held = this.locks.modeOf(txId, key);
    if (held && covers(held, mode)) return;
    if (held === "S" && mode === "X") {
      if (tryUpgrade(this.locks, txId, key, "X")) {
        this.locks.set(txId, key, "X");
        return;
      }
    }

    const fifoBlocked = this.waiters.blocksNew(txId, key, mode);
    const can =
      !fifoBlocked &&
      this.locks.canGrant(txId, key, mode) &&
      (held === null || mode === "X");

    if (can && held === null) {
      this.locks.set(txId, key, mode);
      clearNode(this.waitsFor, txId);
      this.txns.setStatus(txId, "active");
      return;
    }

    if (can && held === "S" && mode === "X") {
      this.locks.set(txId, key, "X");
      clearNode(this.waitsFor, txId);
      this.txns.setStatus(txId, "active");
      return;
    }

    const expireAt = this.clock.now() + this.lockTimeoutMs;
    this.waiters.enqueue({ txId, key, mode, expireAt });
    const blockers = this.locks.blockers(txId, key, mode);
    addEdges(this.waitsFor, txId, blockers);

    if (this.deadlock) {
      try {
        assertNoDeadlock(this.waitsFor, txId, blockers);
      } catch (e) {
        this.waiters.removeTx(txId);
        clearNode(this.waitsFor, txId);
        throw e;
      }
    }

    if (expireAt <= this.clock.now()) {
      this.waiters.removeTx(txId);
      clearNode(this.waitsFor, txId);
      throw new LockTimeoutError(`lock timeout on ${key}`);
    }

    this.txns.setStatus(txId, "waiting");
    throw new LockTimeoutError(`waiting for ${key}`);
  }

  private releaseAll(txId: string): void {
    const touched = new Set<string>([
      ...this.locks.removeAll(txId),
      ...this.waiters.removeTx(txId),
    ]);
    clearNode(this.waitsFor, txId);
    for (const key of touched) this.promote(key);
  }

  private promote(key: string): void {
    const q = this.waiters.queueOf(key);
    for (const w of [...q]) {
      if (!this.locks.canGrant(w.txId, key, w.mode)) break;
      this.waiters.removeTx(w.txId);
      this.locks.set(w.txId, key, w.mode);
      clearNode(this.waitsFor, w.txId);
      this.txns.setStatus(w.txId, "active");
    }
  }
}
