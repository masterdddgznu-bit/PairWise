import { VirtualClock } from "./clock.js";
import { BusyError } from "./errors.js";
import {
  canUpgrade,
  compatible,
  covers,
  intentionFor,
  joinModes,
} from "./compat.js";
import {
  assertNoDeadlock,
  createWaitsFor,
  removeWaiter,
  setEdges,
  type WaitsFor,
} from "./deadlock.js";
import { ancestors } from "./hierarchy.js";
import { LockStore } from "./store.js";
import { WaitQueue, type Waiter } from "./waiters.js";
import type { AcquireOpts, LockMode, WaitInfo } from "./types.js";

type PendingChange = {
  txn: string;
  resource: string;
  mode: LockMode;
  prev: LockMode | null;
};

type Plan =
  | { blocked: null; changes: PendingChange[] }
  | { blocked: string; blockers: string[]; changes: PendingChange[] };

/**
 * Hierarchical multi-granularity lock manager: IS/IX/S/SIX/X modes,
 * ancestor intention locks, FIFO waiters, waits-for deadlock detection
 * and VirtualClock-based timeouts.
 */
export class LockManager {
  readonly clock: VirtualClock;
  /** @internal */ readonly store: LockStore;
  /** @internal */ readonly waiters: WaitQueue;
  /** @internal */ readonly waitsFor: WaitsFor;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.store = new LockStore();
    this.waiters = new WaitQueue();
    this.waitsFor = createWaitsFor();
  }

  acquire(
    txn: string,
    resource: string,
    mode: LockMode = "X",
    opts?: AcquireOpts,
  ): void {
    if (this.waiters.findTxn(txn)) {
      throw new Error(`txn ${txn} already has a pending lock request`);
    }

    const plan = this.planAcquire(txn, resource, mode);
    if (plan.blocked !== null) {
      if (opts?.wait !== true) {
        this.rollback(txn, plan.changes);
        throw new BusyError(`busy: ${plan.blocked}`);
      }
      // Keep the intentions acquired above the blocking level.
      this.apply(plan.changes);
      assertNoDeadlock(this.waitsFor, txn, plan.blockers);
      const expireAt =
        opts.timeoutMs !== undefined ? this.clock.now() + opts.timeoutMs : null;
      this.waiters.enqueue({ txn, resource, mode, expireAt });
      return;
    }

    this.apply(plan.changes);
  }

  release(txn: string, resource: string): boolean {
    const removed = this.store.remove(txn, resource);
    if (removed) this.pump();
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
    const current = this.store.modeOf(txn, resource);
    if (current === null) {
      throw new Error(`txn ${txn} does not hold ${resource}`);
    }
    if (current === mode) return;
    if (!canUpgrade(current, mode)) {
      throw new BusyError(`invalid upgrade ${current} -> ${mode} on ${resource}`);
    }
    const blockers = this.store
      .holders(resource)
      .filter((g) => g.txn !== txn && !compatible(g.mode, mode));
    if (blockers.length > 0) {
      throw new BusyError(`busy: ${resource}`);
    }
    this.store.set(txn, resource, mode);
  }

  releaseAll(txn: string): void {
    this.waiters.removeTxn(txn);
    removeWaiter(this.waitsFor, txn);
    this.store.removeAll(txn);
    this.pump();
  }

  tick(): void {
    const expired = this.waiters.removeExpired(this.clock.now());
    for (const w of expired) {
      removeWaiter(this.waitsFor, w.txn);
    }
    if (expired.length > 0) this.pump();
  }

  /**
   * Walk ancestors top-down then the leaf, recording every store change
   * needed. Planning never mutates the store, so callers can apply the
   * changes atomically, roll them back for a non-waiting conflict, or keep
   * the partial ancestor intentions for a waiting request.
   */
  private planAcquire(
    txn: string,
    resource: string,
    mode: LockMode,
  ): Plan {
    const intention = intentionFor(mode);
    const chain: { resource: string; target: LockMode }[] = ancestors(
      resource,
    ).map((ancestor) => ({ resource: ancestor, target: intention }));
    chain.push({ resource, target: mode });

    const changes: PendingChange[] = [];
    for (const level of chain) {
      const current = this.store.modeOf(txn, level.resource);
      if (current !== null && covers(current, level.target)) continue;

      const required =
        current === null ? level.target : joinModes(current, level.target);

      const blockers = this.store
        .holders(level.resource)
        .filter((g) => g.txn !== txn && !compatible(g.mode, required))
        .map((g) => g.txn);
      if (blockers.length > 0) {
        return { blocked: level.resource, blockers, changes };
      }

      changes.push({
        txn,
        resource: level.resource,
        mode: required,
        prev: current,
      });
    }
    return { blocked: null, changes };
  }

  private apply(changes: PendingChange[]): void {
    for (const change of changes) {
      this.store.set(change.txn, change.resource, change.mode);
    }
  }

  private rollback(txn: string, changes: PendingChange[]): void {
    for (let i = changes.length - 1; i >= 0; i--) {
      const change = changes[i];
      if (change.prev === null) {
        this.store.remove(txn, change.resource);
      } else {
        this.store.set(txn, change.resource, change.prev);
      }
    }
  }

  /**
   * Try granting queued requests. Each resource queue is strictly FIFO:
   * grant compatible requests from the head until the first blocked waiter,
   * stop granting, and keep followers queued behind that head.
   */
  private pump(): void {
    for (const resource of this.waiters.resources()) {
      const queue = this.waiters.queueOf(resource);
      if (queue.length === 0) continue;

      const blockedHeads: Waiter[] = [];
      for (const waiter of queue) {
        const plan = this.planAcquire(waiter.txn, waiter.resource, waiter.mode);
        const blockers = plan.blocked === null ? [] : plan.blockers;

        if (plan.blocked === null && blockedHeads.length === 0) {
          this.apply(plan.changes);
          this.waiters.remove(waiter);
          setEdges(this.waitsFor, waiter.txn, []);
        } else {
          if (blockedHeads.length === 0) blockedHeads.push(waiter);
          // Blocked on a holder, or merely behind the blocked FIFO head:
          // cannot overtake, so edges include real blockers plus every
          // blocked predecessor.
          setEdges(this.waitsFor, waiter.txn, [
            ...blockedHeads.map((w) => w.txn),
            ...blockers,
          ]);
        }
      }
    }
  }
}
