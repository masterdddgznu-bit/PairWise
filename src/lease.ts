import type { VirtualClock } from "./clock.js";
import { LeaseHeldError, StaleFenceError } from "./errors.js";
import type { LeaseInfo } from "./types.js";

/** Lease state machine driven by a VirtualClock. */
export class LeaseManager {
  private lease: LeaseInfo | null = null;
  private globalFence = 0;

  constructor(private readonly clock: VirtualClock) {}

  /** Returns the current lease if it is still live, otherwise clears it. */
  private live(): LeaseInfo | null {
    if (this.lease !== null && this.clock.now() >= this.lease.expiresAt) {
      this.lease = null;
    }
    return this.lease;
  }

  acquire(holderId: string, ttlMs: number): { fence: number } {
    const current = this.live();
    if (current === null) {
      const fence = ++this.globalFence;
      this.lease = {
        holderId,
        fence,
        expiresAt: this.clock.now() + ttlMs,
      };
      return { fence };
    }
    if (current.holderId === holderId) {
      current.expiresAt = this.clock.now() + ttlMs;
      return { fence: current.fence };
    }
    throw new LeaseHeldError();
  }

  renew(holderId: string, fence: number, ttlMs: number): void {
    const current = this.live();
    if (current === null) {
      throw new StaleFenceError();
    }
    if (current.holderId !== holderId) {
      throw new LeaseHeldError();
    }
    if (current.fence !== fence) {
      throw new StaleFenceError();
    }
    current.expiresAt = this.clock.now() + ttlMs;
  }

  release(holderId: string, fence: number): void {
    const current = this.live();
    if (
      current === null ||
      current.holderId !== holderId ||
      current.fence !== fence
    ) {
      throw new StaleFenceError();
    }
    this.lease = null;
  }

  current(): LeaseInfo | null {
    return this.live();
  }

  assertFence(fence: number | undefined): void {
    const current = this.live();
    if (current === null || current.fence !== fence) {
      throw new StaleFenceError();
    }
  }
}
