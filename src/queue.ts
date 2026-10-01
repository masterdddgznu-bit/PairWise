import type { VirtualClock } from "./clock.js";
import type { BatchSnapshot } from "./types.js";
import { PendingStore } from "./store.js";
import { shouldFlushBySize, isDue, oldestTimestamp } from "./batch.js";
import { exportSnapshot, importSnapshot } from "./recover.js";

export type BatchQueueOptions = {
  maxBatch: number;
  maxWaitMs: number;
};

export class BatchQueue<T = string> {
  private store = new PendingStore();

  constructor(
    private readonly clock: VirtualClock,
    private readonly opts: BatchQueueOptions,
  ) {}

  private maybeTimeFlush(tenant: string): T[] | null {
    const items = this.store.forTenant(tenant);
    const oldest = oldestTimestamp(items);
    if (oldest === null) return null;
    const now = this.clock.now();
    if (isDue(oldest, now, this.opts.maxWaitMs)) {
      return this.store.drain(tenant) as T[];
    }
    return null;
  }

  enqueue(tenant: string, item: T): { flushed: T[] | null } {
    const pre = this.maybeTimeFlush(tenant);
    if (pre !== null) {
      this.store.append(tenant, String(item), this.clock.now());
      return { flushed: pre };
    }
    this.store.append(tenant, String(item), this.clock.now());
    const count = this.store.count(tenant);
    if (shouldFlushBySize(count, this.opts.maxBatch)) {
      return { flushed: this.store.drain(tenant) as T[] };
    }
    const post = this.maybeTimeFlush(tenant);
    if (post !== null) {
      return { flushed: post };
    }
    return { flushed: null };
  }

  flush(tenant: string): T[] {
    return this.store.drain(tenant) as T[];
  }

  pending(tenant: string): number {
    return this.store.count(tenant);
  }

  peek(tenant: string): T[] {
    return [...this.store.peekPayloads(tenant)] as T[];
  }

  poll(): Record<string, T[]> {
    const now = this.clock.now();
    const out: Record<string, T[]> = {};
    for (const tenant of this.store.tenantKeys()) {
      const items = this.store.forTenant(tenant);
      const oldest = oldestTimestamp(items);
      if (oldest !== null && isDue(oldest, now, this.opts.maxWaitMs)) {
        out[tenant] = this.store.drain(tenant) as T[];
      }
    }
    return out;
  }

  exportState(): BatchSnapshot<T> {
    return exportSnapshot(this.store) as BatchSnapshot<T>;
  }

  importState(state: BatchSnapshot<T>): void {
    importSnapshot(this.store, state as BatchSnapshot);
  }

  clearTenant(tenant: string): void {
    this.store.clearTenant(tenant);
  }
}
