import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidAcquireError,
  InvalidConfigError,
  UnknownTicketError,
} from "./errors.js";

export interface SpanOwnOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxWaiters?: number;
}

export interface AcquireOptions {
  priority?: number;
}

export type AcquireResult =
  | { status: "granted"; fence: number }
  | { status: "waiting"; ticket: number };

export interface HoldInfo {
  lo: number;
  hi: number;
  fence: number;
}

export interface DriveResult {
  expiredFences: number[];
}

interface Hold {
  holderId: string;
  lo: number;
  hi: number;
  fence: number;
  leaseDeadline: number;
}

interface Waiter {
  holderId: string;
  lo: number;
  hi: number;
  priority: number;
  ticket: number;
}

function overlaps(aLo: number, aHi: number, bLo: number, bHi: number): boolean {
  return aLo < bHi && aHi > bLo;
}

export class SpanOwn {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxWaiters: number;

  private readonly holds = new Map<number, Hold>();
  private readonly waiters = new Map<number, Waiter>();
  private readonly knownTickets = new Set<number>();
  private nextFence = 1;
  private nextTicket = 1;

  constructor(options: SpanOwnOptions) {
    if (!options || !(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    if (!Number.isFinite(options.leaseMs) || options.leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be a finite number >= 1");
    }
    const maxWaiters = options.maxWaiters ?? 8;
    if (!Number.isFinite(maxWaiters) || maxWaiters < 1) {
      throw new InvalidConfigError("maxWaiters must be a finite number >= 1");
    }
    this.clock = options.clock;
    this.leaseMs = options.leaseMs;
    this.maxWaiters = maxWaiters;
  }

  acquire(
    holderId: string,
    lo: number,
    hi: number,
    opts?: AcquireOptions,
  ): AcquireResult {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidAcquireError("holderId must be a non-empty string");
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) {
      throw new InvalidAcquireError(
        "span must be finite numbers with lo < hi",
      );
    }
    const priority = opts?.priority ?? 0;

    for (const hold of this.holds.values()) {
      if (
        hold.holderId === holderId &&
        overlaps(hold.lo, hold.hi, lo, hi)
      ) {
        throw new InvalidAcquireError(
          "span overlaps an interval already held by this holder",
        );
      }
    }
    for (const waiter of this.waiters.values()) {
      if (
        waiter.holderId === holderId &&
        waiter.lo === lo &&
        waiter.hi === hi
      ) {
        throw new InvalidAcquireError(
          "already waiting for the same span",
        );
      }
    }

    if (!this.overlapsAnyHold(lo, hi)) {
      const fence = this.grant(holderId, lo, hi);
      return { status: "granted", fence };
    }

    if (this.waiters.size >= this.maxWaiters) {
      throw new InvalidAcquireError("wait queue is full");
    }
    const ticket = this.nextTicket++;
    this.waiters.set(ticket, { holderId, lo, hi, priority, ticket });
    this.knownTickets.add(ticket);
    return { status: "waiting", ticket };
  }

  heartbeat(holderId: string, fence: number): boolean {
    const hold = this.holds.get(fence);
    if (!hold) {
      return false;
    }
    if (hold.holderId !== holderId) {
      throw new FenceError("fence is not held by this holder");
    }
    hold.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(holderId: string, fence: number): boolean {
    const hold = this.holds.get(fence);
    if (!hold) {
      return false;
    }
    if (hold.holderId !== holderId) {
      throw new FenceError("fence is not held by this holder");
    }
    this.holds.delete(fence);
    this.promote();
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    if (!this.knownTickets.has(ticket)) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    const waiter = this.waiters.get(ticket);
    if (!waiter) {
      return false;
    }
    if (waiter.holderId !== holderId) {
      return false;
    }
    this.waiters.delete(ticket);
    this.knownTickets.delete(ticket);
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expiredFences: number[] = [];
    for (const [fence, hold] of this.holds) {
      if (now >= hold.leaseDeadline) {
        this.holds.delete(fence);
        expiredFences.push(fence);
      }
    }
    expiredFences.sort((a, b) => a - b);
    this.promote();
    return { expiredFences };
  }

  ownerAt(x: number): string | undefined {
    for (const hold of this.holds.values()) {
      if (hold.lo <= x && x < hold.hi) {
        return hold.holderId;
      }
    }
    return undefined;
  }

  holdsOf(holderId: string): HoldInfo[] {
    const result: HoldInfo[] = [];
    for (const hold of this.holds.values()) {
      if (hold.holderId === holderId) {
        result.push({ lo: hold.lo, hi: hold.hi, fence: hold.fence });
      }
    }
    result.sort((a, b) => a.lo - b.lo || a.fence - b.fence);
    return result;
  }

  waitingTickets(): number[] {
    return this.sortedWaiters().map((waiter) => waiter.ticket);
  }

  private grant(holderId: string, lo: number, hi: number): number {
    const fence = this.nextFence++;
    this.holds.set(fence, {
      holderId,
      lo,
      hi,
      fence,
      leaseDeadline: this.clock.now() + this.leaseMs,
    });
    return fence;
  }

  private overlapsAnyHold(lo: number, hi: number): boolean {
    for (const hold of this.holds.values()) {
      if (overlaps(hold.lo, hold.hi, lo, hi)) {
        return true;
      }
    }
    return false;
  }

  private sortedWaiters(): Waiter[] {
    return [...this.waiters.values()].sort(
      (a, b) => b.priority - a.priority || a.ticket - b.ticket,
    );
  }

  private promote(): void {
    for (;;) {
      const grantable = this.sortedWaiters().find(
        (waiter) => !this.overlapsAnyHold(waiter.lo, waiter.hi),
      );
      if (!grantable) {
        return;
      }
      this.waiters.delete(grantable.ticket);
      this.grant(grantable.holderId, grantable.lo, grantable.hi);
    }
  }
}
