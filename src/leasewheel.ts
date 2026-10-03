import { VirtualClock } from "./clock.js";
import { InvalidConfigError, InvalidLeaseError } from "./errors.js";
import { LeaseBook } from "./leases.js";
import { SlotRing } from "./slots.js";
import type { ExpiredLease, LeaseWheelOptions } from "./types.js";
import { WheelIndex } from "./wheel.js";

export class LeaseWheel<T = string> {
  readonly clock: VirtualClock;
  private readonly slots: SlotRing<T>;
  private readonly index: WheelIndex;
  private readonly book = new LeaseBook<T>();
  private readonly tickMs: number;
  private readonly slotCount: number;
  private hand = 0;
  private lastDriveAt = 0;
  private remainder = 0;

  constructor(opts: LeaseWheelOptions) {
    if (!Number.isInteger(opts.slotCount) || opts.slotCount < 2) {
      throw new InvalidConfigError("slotCount");
    }
    if (!Number.isInteger(opts.tickMs) || opts.tickMs < 1) {
      throw new InvalidConfigError("tickMs");
    }
    this.clock = opts.clock;
    this.slotCount = opts.slotCount;
    this.tickMs = opts.tickMs;
    this.slots = new SlotRing(opts.slotCount);
    this.index = new WheelIndex(opts.slotCount, opts.tickMs);
    this.lastDriveAt = opts.clock.now();
  }

  schedule(leaseId: string, ttlMs: number, payload: T): void {
    if (!leaseId) throw new InvalidLeaseError("empty id");
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new InvalidLeaseError("ttl");
    const expireAt = this.clock.now() + ttlMs;
    const slot = this.index.targetSlot(this.hand, ttlMs);
    const lease = { leaseId, payload, expireAt, slot };
    this.book.set(lease);
    this.slots.place(slot, lease);
  }

  cancel(leaseId: string): boolean {
    if (!this.book.has(leaseId)) return false;
    this.book.delete(leaseId);
    return true;
  }

  drive(): void {
    const now = this.clock.now();
    let delta = now - this.lastDriveAt + this.remainder;
    this.lastDriveAt = now;
    if (delta < this.tickMs) {
      this.remainder = delta;
      return;
    }
    let ticks = Math.floor(delta / this.tickMs);
    this.remainder = delta % this.tickMs;
    while (ticks > 0) {
      const got = this.slots.takeSlot(this.hand);
      for (const lease of got) {
        if (!this.book.has(lease.leaseId)) continue;
        const cur = this.book.get(lease.leaseId)!;
        this.book.delete(lease.leaseId);
        this.book.pushExpired({
          leaseId: lease.leaseId,
          payload: lease.payload,
          expireAt: lease.expireAt,
        });
      }
      this.hand = (this.hand + 1) % this.slotCount;
      ticks -= 1;
    }
  }

  pollExpired(): ExpiredLease<T>[] {
    return this.book.drainExpired();
  }

  has(leaseId: string): boolean {
    return this.book.has(leaseId);
  }

  size(): number {
    return this.book.size();
  }

  pendingExpired(): number {
    return this.book.pendingExpired();
  }
}
