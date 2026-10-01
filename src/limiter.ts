import type { VirtualClock } from "./clock.js";
import type { CheckResult, LimiterSnapshot } from "./types.js";
import { EventStore } from "./store.js";
import {
  countInWindow,
  computeResetAt,
  remainingCount,
} from "./window.js";
import { exportSnapshot, importSnapshot } from "./recover.js";

export type RateLimiterOptions = {
  windowMs: number;
  limit: number;
};

export class RateLimiter {
  private store = new EventStore();

  constructor(
    private readonly clock: VirtualClock,
    private readonly opts: RateLimiterOptions,
  ) {}

  allow(tenant: string, key: string): boolean {
    const now = this.clock.now();
    this.store.gc(now, this.opts.windowMs);
    const events = this.store.forKey(tenant, key);
    const count = countInWindow(events, now, this.opts.windowMs);
    this.store.add({ tenant, key, ts: now });
    return count < this.opts.limit;
  }

  check(tenant: string, key: string): CheckResult {
    const now = this.clock.now();
    this.store.gc(now, this.opts.windowMs);
    const events = this.store.forKey(tenant, key);
    const count = countInWindow(events, now, this.opts.windowMs);
    const allowed = count < this.opts.limit;
    if (allowed) {
      this.store.add({ tenant, key, ts: now });
    }
    const remaining = remainingCount(count, this.opts.limit);
    const resetAt = computeResetAt(events, now, this.opts.windowMs, this.opts.limit);
    return { allowed, remaining, resetAt };
  }

  reset(tenant: string, key: string): void {
    this.store.resetKey(tenant, key);
  }

  clearTenant(tenant: string): void {
    this.store.clearTenant(tenant);
  }

  exportState(): LimiterSnapshot {
    return exportSnapshot(this.store);
  }

  importState(snapshot: LimiterSnapshot): void {
    importSnapshot(this.store, this.clock, snapshot);
  }
}
