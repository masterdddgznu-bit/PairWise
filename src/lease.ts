import type { VirtualClock } from "./clock.js";
import { LeaseHeldError, StaleFenceError } from "./errors.js";
import type { LeaseInfo } from "./types.js";

/** Lease state machine driven by a VirtualClock. */
export class LeaseManager {
  private currentLease: LeaseInfo | null = null;
  private globalFence = 0;

  constructor(private readonly clock: VirtualClock) {}

  acquire(holderId: string, ttlMs: number): { fence: number } {
    const active = this.current();
    if (active === null) {
      return this.grant(holderId, ttlMs);
    }
    if (active.holderId === holderId) {
      active.expiresAt = this.clock.now() + ttlMs;
      return { fence: active.fence };
    }
    throw new LeaseHeldError();
  }

  renew(holderId: string, fence: number, ttlMs: number): void {
    const active = this.current();
    if (active === null) {
      throw new StaleFenceError();
    }
    if (active.holderId !== holderId) {
      throw new LeaseHeldError();
    }
    if (active.fence !== fence) {
      throw new StaleFenceError();
    }
    active.expiresAt = this.clock.now() + ttlMs;
  }

  release(holderId: string, fence: number): void {
    const active = this.current();
    if (active === null || active.holderId !== holderId || active.fence !== fence) {
      throw new StaleFenceError();
    }
    this.currentLease = null;
  }

  current(): LeaseInfo | null {
    if (this.currentLease !== null && this.clock.now() >= this.currentLease.expiresAt) {
      this.currentLease = null;
    }
    return this.currentLease;
  }

  assertFence(_fence: number): void {
    const active = this.current();
    if (active === null || active.fence !== _fence) {
      throw new StaleFenceError();
    }
  }

  private grant(holderId: string, ttlMs: number): { fence: number } {
    const fence = ++this.globalFence;
    this.currentLease = {
      holderId,
      fence,
      expiresAt: this.clock.now() + ttlMs,
    };
    return { fence };
  }
}
