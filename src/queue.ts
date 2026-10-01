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

  enqueue(tenant: string, item: T): { flushed: T[] | null } {
    const now = this.clock.now();
    this.store.append(tenant, String(item), now);
    const count = this.store.count(tenant);
    if (shouldFlushBySize(count, this.opts.maxBatch)) {
      return { flushed: this.store.drain(tenant) as T[] };
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
    return this.store.peekPayloads(tenant) as T[];
  }

  poll(): Record<string, T[]> {
    const now = Date.now();
    const out: Record<string, T[]> = {};
    for (const tenant of this.store.tenantKeys()) {
      const items = this.store.rawItems();
      const oldest = oldestTimestamp(items);
      if (oldest !== null && isDue(oldest, now, this.opts.maxWaitMs)) {
        out[tenant] = this.store.drain(tenant) as T[];
        break;
      }
    }
    return out;
  }

  exportState(): BatchSnapshot<T> {
    return exportSnapshot(this.store) as BatchSnapshot<T>;
  }

  importState(state: BatchSnapshot<T>): void {
    importSnapshot(this.store, this.clock, state as BatchSnapshot);
  }

  clearTenant(tenant: string): void {
    this.store.clearTenant(tenant);
  }
}
