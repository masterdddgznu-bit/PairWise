import { VirtualClock } from "./clock.js";
import { BusyError } from "./errors.js";
import { ancestors } from "./hierarchy.js";
import {
  canUpgrade,
  compatible,
  covers,
  intentionFor,
  lub,
} from "./compat.js";
import { assertNoDeadlock } from "./deadlock.js";
import { LockStore } from "./store.js";
import { WaitQueue } from "./waiters.js";
import type { AcquireOpts, LockMode, WaitInfo } from "./types.js";

type LevelGrant = { resource: string; prev: LockMode | null };

type Attempt =
  | { ok: true; granted: LevelGrant[] }
  | { ok: false; blockers: string[]; granted: LevelGrant[] };

/**
 * Hierarchical multi-granularity lock manager.
 * IS/IX/S/SIX/X modes, ancestor intention locks, FIFO waiters,
 * deadlock detection and virtual-clock timeouts.
 */
export class LockManager {
  readonly clock: VirtualClock;
  /** @internal */ readonly store: LockStore;
  /** @internal */ readonly waiters: WaitQueue;
  /** @internal */ readonly waitsFor = new Map<string, Set<string>>();

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.store = new LockStore();
    this.waiters = new WaitQueue();
  }

  acquire(
    txn: string,
    resource: string,
    mode: LockMode = "X",
    opts?: AcquireOpts,
  ): void {
    const attempt = this.tryAcquire(txn, resource, mode, false);
    if (attempt.ok) return;

    if (opts?.wait !== true) {
      this.rollback(txn, attempt.granted);
      throw new BusyError(`busy: ${resource}`);
    }

    this.rebuildWaitsFor();
    try {
      assertNoDeadlock(this.waitsFor, txn, attempt.blockers);
    } catch (err) {
      this.rollback(txn, attempt.granted);
      throw err;
    }

    const expireAt =
      opts.timeoutMs !== undefined
        ? this.clock.now() + opts.timeoutMs
        : null;
    this.waiters.enqueue({ txn, resource, mode, expireAt });
  }

  release(txn: string, resource: string): boolean {
    const removed = this.store.remove(txn, resource);
    if (removed) this.pumpAll();
    return removed;
  }

  holds(txn: string, resource: string): boolean {
    return this.store.modeOf(txn, resource) !== null;
  }

  modeOf(txn: string, resource: string): LockMode | null {
    return this.store.modeOf(txn, resource);
  }

  isWaiting(txn: string): WaitInfo | null {
    const w = this.waiters.findTxn(txn);
    return w ? { resource: w.resource, mode: w.mode } : null;
  }

  upgrade(txn: string, resource: string, mode: LockMode): void {
    const cur = this.store.modeOf(txn, resource);
    if (cur === null) {
      throw new BusyError(`not held: ${resource}`);
    }
    if (!canUpgrade(cur, mode)) {
      throw new BusyError(`cannot upgrade ${cur} to ${mode}: ${resource}`);
    }
    const blocked = this.store
      .holders(resource)
      .some((g) => g.txn !== txn && !compatible(g.mode, mode));
    if (blocked) {
      throw new BusyError(`busy: ${resource}`);
    }
    this.store.set(txn, resource, mode);
  }

  releaseAll(txn: string): void {
    this.waiters.removeTxn(txn);
    this.waitsFor.delete(txn);
    this.store.removeAll(txn);
    this.pumpAll();
  }

  tick(): void {
    this.waiters.removeExpired(this.clock.now());
    this.pumpAll();
  }

  /**
   * Walk ancestors top-down then the leaf, acquiring the intention lock
   * each level requires. Stops at the first conflicting level; grants
   * already applied above that level are reported for rollback/retention.
   */
  private tryAcquire(
    txn: string,
    resource: string,
    mode: LockMode,
    dryRun: boolean,
  ): Attempt {
    const levels = [...ancestors(resource), resource];
    const granted: LevelGrant[] = [];

    for (const level of levels) {
      const desired =
        level === resource ? mode : intentionFor(mode);
      const cur = this.store.modeOf(txn, level);
      let effective = desired;
      if (cur) {
        if (covers(cur, desired)) continue;
        effective = lub(cur, desired);
        if (!canUpgrade(cur, effective)) {
          return { ok: false, blockers: [], granted };
        }
      }
      const blockers: string[] = [];
      for (const g of this.store.holders(level)) {
        if (g.txn !== txn && !compatible(g.mode, effective)) {
          blockers.push(g.txn);
        }
      }
      if (blockers.length > 0) {
        return { ok: false, blockers: [...new Set(blockers)], granted };
      }
      if (!dryRun) {
        this.store.set(txn, level, effective);
        granted.push({ resource: level, prev: cur });
      }
    }
    return { ok: true, granted };
  }

  private rollback(txn: string, granted: LevelGrant[]): void {
    for (let i = granted.length - 1; i >= 0; i--) {
      const g = granted[i];
      if (g.prev === null) {
        this.store.remove(txn, g.resource);
      } else {
        this.store.set(txn, g.resource, g.prev);
      }
    }
  }

  /** Rebuild the global waits-for graph from every queued waiter. */
  private rebuildWaitsFor(): void {
    this.waitsFor.clear();
    for (const w of this.waiters.all()) {
      const attempt = this.tryAcquire(w.txn, w.resource, w.mode, true);
      if (!attempt.ok && attempt.blockers.length > 0) {
        this.waitsFor.set(w.txn, new Set(attempt.blockers));
      }
    }
  }

  /**
   * Grant queued waiters of one resource in FIFO order; the first
   * request that still cannot be granted stops further grants.
   */
  private pump(resource: string): void {
    for (const w of this.waiters.queueOf(resource)) {
      const attempt = this.tryAcquire(w.txn, w.resource, w.mode, false);
      if (!attempt.ok) return;
      this.waiters.remove(w);
    }
  }

  /** Repeatedly pump every queue until no further waiter can be granted. */
  private pumpAll(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const resource of this.waiters.resources()) {
        const before = this.waiters.queueOf(resource).length;
        this.pump(resource);
        if (this.waiters.queueOf(resource).length < before) {
          progressed = true;
        }
      }
    }
  }
}
