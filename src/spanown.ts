import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidAcquireError,
  InvalidConfigError,
  UnknownTicketError,
} from "./errors.js";

export interface SpanOwnConfig {
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

export interface DriveResult {
  expiredFences: number[];
}

export interface HoldInfo {
  lo: number;
  hi: number;
  fence: number;
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
  ticket: number;
  priority: number;
  enqueuedAt: number;
}

function overlaps(lo: number, hi: number, otherLo: number, otherHi: number): boolean {
  return lo < otherHi && hi > otherLo;
}

export class SpanOwn {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxWaiters: number;
  private holds: Hold[] = [];
  private waiters: Waiter[] = [];
  private readonly ticketState = new Map<number, { holderId: string; waiting: boolean }>();
  private nextFence = 1;
  private nextTicket = 1;

  constructor(config: SpanOwnConfig) {
    const { clock, leaseMs, maxWaiters = 8 } = config;
    if (!clock) {
      throw new InvalidConfigError("clock is required");
    }
    if (!Number.isFinite(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be a finite number >= 1");
    }
    if (!Number.isFinite(maxWaiters) || maxWaiters < 1) {
      throw new InvalidConfigError("maxWaiters must be a finite number >= 1");
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.maxWaiters = maxWaiters;
  }

  acquire(holderId: string, lo: number, hi: number, opts?: AcquireOptions): AcquireResult {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidAcquireError("holderId must be a non-empty string");
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) {
      throw new InvalidAcquireError("span must satisfy finite lo < hi");
    }
    for (const hold of this.holds) {
      if (hold.holderId === holderId && overlaps(lo, hi, hold.lo, hold.hi)) {
        throw new InvalidAcquireError("span overlaps an interval already held by this holder");
      }
    }
    for (const waiter of this.waiters) {
      if (waiter.holderId === holderId && waiter.lo === lo && waiter.hi === hi) {
        throw new InvalidAcquireError("already waiting for the same span");
      }
    }
    const blocked = this.holds.some((hold) => overlaps(lo, hi, hold.lo, hold.hi));
    if (!blocked) {
      const fence = this.nextFence++;
      this.holds.push({
        holderId,
        lo,
        hi,
        fence,
        leaseDeadline: this.clock.now() + this.leaseMs,
      });
      return { status: "granted", fence };
    }
    if (this.waiters.length >= this.maxWaiters) {
      throw new InvalidAcquireError("wait queue is full");
    }
    const ticket = this.nextTicket++;
    this.waiters.push({
      holderId,
      lo,
      hi,
      ticket,
      priority: opts?.priority ?? 0,
      enqueuedAt: this.clock.now(),
    });
    this.ticketState.set(ticket, { holderId, waiting: true });
    return { status: "waiting", ticket };
  }

  heartbeat(holderId: string, fence: number): boolean {
    const hold = this.holds.find((h) => h.fence === fence);
    if (!hold) {
      return false;
    }
    if (hold.holderId !== holderId) {
      throw new FenceError("fence does not belong to this holder");
    }
    hold.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(holderId: string, fence: number): boolean {
    const index = this.holds.findIndex((h) => h.fence === fence);
    if (index === -1) {
      return false;
    }
    if (this.holds[index].holderId !== holderId) {
      throw new FenceError("fence does not belong to this holder");
    }
    this.holds.splice(index, 1);
    this.promote();
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const state = this.ticketState.get(ticket);
    if (!state) {
      throw new UnknownTicketError("unknown ticket");
    }
    if (state.holderId !== holderId || !state.waiting) {
      return false;
    }
    this.waiters = this.waiters.filter((w) => w.ticket !== ticket);
    this.ticketState.delete(ticket);
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expiredFences: number[] = [];
    this.holds = this.holds.filter((hold) => {
      if (now >= hold.leaseDeadline) {
        expiredFences.push(hold.fence);
        return false;
      }
      return true;
    });
    expiredFences.sort((a, b) => a - b);
    this.promote();
    return { expiredFences };
  }

  ownerAt(x: number): string | undefined {
    const hold = this.holds.find((h) => h.lo <= x && x < h.hi);
    return hold?.holderId;
  }

  holdsOf(holderId: string): HoldInfo[] {
    return this.holds
      .filter((h) => h.holderId === holderId)
      .map((h) => ({ lo: h.lo, hi: h.hi, fence: h.fence }))
      .sort((a, b) => a.lo - b.lo || a.fence - b.fence);
  }

  waitingTickets(): number[] {
    return this.orderedWaiters().map((w) => w.ticket);
  }

  private orderedWaiters(): Waiter[] {
    return [...this.waiters].sort(
      (a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt || a.ticket - b.ticket,
    );
  }

  private promote(): void {
    for (;;) {
      let granted = false;
      for (const waiter of this.orderedWaiters()) {
        const blocked = this.holds.some((hold) =>
          overlaps(waiter.lo, waiter.hi, hold.lo, hold.hi),
        );
        if (blocked) {
          continue;
        }
        this.waiters = this.waiters.filter((w) => w.ticket !== waiter.ticket);
        const fence = this.nextFence++;
        this.holds.push({
          holderId: waiter.holderId,
          lo: waiter.lo,
          hi: waiter.hi,
          fence,
          leaseDeadline: this.clock.now() + this.leaseMs,
        });
        const state = this.ticketState.get(waiter.ticket);
        if (state) {
          state.waiting = false;
        }
        granted = true;
        break;
      }
      if (!granted) {
        return;
      }
    }
  }
}
