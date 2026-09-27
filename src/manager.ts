import { VirtualClock } from "./clock.js";
import { BusyError } from "./errors.js";
import { ancestors } from "./hierarchy.js";
import { LockStore } from "./store.js";
import { WaitQueue } from "./waiters.js";
import type { AcquireOpts, LockMode, WaitInfo } from "./types.js";

/**
 * Hierarchical multi-granularity lock manager.
 * Base exclusive X acquire/release/holds work.
 */
export class LockManager {
  readonly clock: VirtualClock;
  /** @internal */ readonly store: LockStore;
  /** @internal */ readonly waiters: WaitQueue;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.store = new LockStore();
    this.waiters = new WaitQueue();
  }

  acquire(txn: string, resource: string, mode: LockMode = "X", opts?: AcquireOpts): void {
    if (mode !== "X" || opts?.wait || opts?.timeoutMs !== undefined) {
      // Feature path — starter only supports immediate X without wait.
      if (mode !== "X") {
        throw new Error("non-X lock modes not implemented");
      }
      throw new Error("wait/timeout not implemented");
    }
    const cur = this.store.modeOf(txn, resource);
    if (cur === "X") return;
    const others = this.store.holders(resource).filter((g) => g.txn !== txn);
    if (others.length > 0) {
      throw new BusyError(`busy: ${resource}`);
    }
    this.store.set(txn, resource, "X");
    void ancestors;
  }

  release(txn: string, resource: string): boolean {
    return this.store.remove(txn, resource);
  }

  holds(txn: string, resource: string): boolean {
    return this.store.modeOf(txn, resource) !== null;
  }

  modeOf(txn: string, resource: string): LockMode | null {
    return this.store.modeOf(txn, resource);
  }

  isWaiting(_txn: string): WaitInfo | null {
    throw new Error("isWaiting not implemented");
  }

  upgrade(_txn: string, _resource: string, _mode: LockMode): void {
    throw new Error("upgrade not implemented");
  }

  releaseAll(_txn: string): void {
    throw new Error("releaseAll not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }
}
