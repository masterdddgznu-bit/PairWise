import type { VirtualClock } from "./clock.js";
import type { DedupSnapshot } from "./types.js";
import { DedupStore } from "./store.js";
import { exportSnapshot, importSnapshot } from "./recover.js";

export type DedupLogOptions = {
  ttlMs: number;
};

export class DedupLog {
  private store = new DedupStore();

  constructor(
    private readonly clock: VirtualClock,
    private readonly opts: DedupLogOptions,
  ) {}

  accept(tenant: string, id: string): boolean {
    const now = this.clock.now();
    this.store.gc(now, this.opts.ttlMs);
    const existing = this.store.get(tenant, id);
    if (existing) {
      return false;
    }
    this.store.set({ tenant, id, seenAt: now });
    return true;
  }

  has(tenant: string, id: string): boolean {
    this.store.gc(this.clock.now(), this.opts.ttlMs);
    return this.store.get(tenant, id) !== undefined;
  }

  seenAt(tenant: string, id: string): number | undefined {
    this.store.gc(this.clock.now(), this.opts.ttlMs);
    const existing = this.store.get(tenant, id);
    if (!existing) return undefined;
    return existing.seenAt;
  }

  gc(): void {
    this.store.gc(this.clock.now(), this.opts.ttlMs);
  }

  clearTenant(tenant: string): void {
    this.store.clearTenant(tenant);
  }

  size(tenant?: string): number {
    this.store.gc(this.clock.now(), this.opts.ttlMs);
    if (tenant !== undefined) {
      return this.store.countForTenant(tenant);
    }
    return this.store.rawSize();
  }

  exportState(): DedupSnapshot {
    return exportSnapshot(this.store);
  }

  importState(state: DedupSnapshot): void {
    importSnapshot(this.store, this.clock, this.opts.ttlMs, state);
  }
}
