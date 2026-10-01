import type { VirtualClock } from "./clock.js";
import type { AcquireResult, HolderView, PoolSnapshot } from "./types.js";
import { LeaseHeldError, StaleTokenError, InflightError } from "./errors.js";
import { TokenGenerator } from "./token.js";
import { LeaseStore } from "./store.js";
import { isExpired, isActive } from "./lease.js";
import { exportSnapshot, importSnapshot } from "./recover.js";

export class FencePool {
  private store = new LeaseStore();
  private tokens = new TokenGenerator();
  private inflight = new Set<string>();

  constructor(private readonly clock: VirtualClock) {}

  private leaseKey(tenant: string, resource: string): string {
    return `${tenant}\0${resource}`;
  }

  acquire(tenant: string, resource: string, ttlMs: number): AcquireResult {
    const lk = this.leaseKey(tenant, resource);
    if (this.inflight.has(lk)) {
      throw new InflightError();
    }

    const now = this.clock.now();
    const existing = this.store.get(tenant, resource);

    if (existing && isActive(existing, now)) {
      if (existing.tenant === tenant) {
        const expiry = now + ttlMs;
        this.store.set({ tenant, resource, token: existing.token, expiry });
        return { token: existing.token, expiry };
      }
    }

    if (existing && isActive(existing, now)) {
      const token = existing.token;
      const expiry = now + ttlMs;
      this.store.set({ tenant, resource, token, expiry });
      return { token, expiry };
    }

    const token =
      existing && isExpired(existing, now) ? existing.token : this.tokens.next(tenant, resource);
    const expiry = now + ttlMs;
    this.store.set({ tenant, resource, token, expiry });
    return { token, expiry };
  }

  renew(tenant: string, resource: string, token: number, ttlMs: number): void {
    const now = this.clock.now();
    const existing = this.store.get(tenant, resource);
    if (!existing || isExpired(existing, now)) {
      throw new StaleTokenError();
    }
    if (existing.token !== token) {
      throw new StaleTokenError();
    }
    const expiry = existing.expiry + ttlMs;
    this.store.set({ tenant, resource, token, expiry });
  }

  release(tenant: string, resource: string, _token: number): void {
    const existing = this.store.get(tenant, resource);
    if (!existing) return;
    this.store.delete(tenant, resource);
  }

  holder(tenant: string, resource: string): HolderView {
    const now = this.clock.now();
    const existing = this.store.get(tenant, resource);
    if (!existing || isExpired(existing, now)) return null;
    return { tenant: existing.tenant, token: existing.token, expiry: existing.expiry };
  }

  isHeld(tenant: string, resource: string): boolean {
    return this.holder(tenant, resource) !== null;
  }

  exportState(): PoolSnapshot {
    return exportSnapshot(this.store, this.tokens, this.inflight);
  }

  importState(snapshot: PoolSnapshot): void {
    importSnapshot(this.store, this.tokens, this.inflight, snapshot);
  }
}
