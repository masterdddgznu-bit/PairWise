import type { VirtualClock } from "./clock.js";
import type { DedupSnapshot } from "./types.js";
import { DedupStore } from "./store.js";
import { isActive, isExpired } from "./entry.js";
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

  private touchGc(): void {
    this.store.gc(this.clock.now(), this.opts.ttlMs);
  }

  accept(tenant: string, id: string): boolean {
    this.touchGc();
    const now = this.clock.now();
    const existing = this.store.get(tenant, id);
    if (existing && isActive(existing, now, this.opts.ttlMs)) {
      return false;
    }
    this.store.set({ tenant, id, seenAt: now });
    return true;
  }

  has(tenant: string, id: string): boolean {
    this.touchGc();
    const existing = this.store.get(tenant, id);
    if (!existing) return false;
    return isActive(existing, this.clock.now(), this.opts.ttlMs);
  }

  seenAt(tenant: string, id: string): number | undefined {
    this.touchGc();
    const existing = this.store.get(tenant, id);
    if (!existing) return undefined;
    const now = this.clock.now();
    if (isExpired(existing, now, this.opts.ttlMs)) return undefined;
    return existing.seenAt;
  }

  gc(): void {
    this.store.gc(this.clock.now(), this.opts.ttlMs);
  }

  clearTenant(tenant: string): void {
    this.store.clearTenant(tenant);
  }

  size(tenant?: string): number {
    this.touchGc();
    return this.store.countActive(this.clock.now(), this.opts.ttlMs, tenant);
  }

  exportState(): DedupSnapshot {
    return exportSnapshot(this.store);
  }

  importState(state: DedupSnapshot): void {
    importSnapshot(this.store, this.clock, this.opts.ttlMs, state);
  }
}
