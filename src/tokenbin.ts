import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidRequestError,
  UnknownTicketError,
} from "./errors.js";

export interface TokenBinOptions {
  clock: VirtualClock;
  capacity: number;
  refillPerMs: number;
  maxDebt?: number;
  maxQueue?: number;
}

export type RequestResult =
  | { status: "ok" }
  | { status: "queued"; ticket: number }
  | { status: "rejected" };

interface Waiter {
  ticket: number;
  key: string;
  cost: number;
  enqueuedAt: number;
}

export class TokenBin {
  private readonly clock: VirtualClock;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxDebt: number;
  private readonly maxQueue: number;

  private tokensNow: number;
  private lastRefillAt = 0;
  private nextTicket = 1;
  private readonly waiters = new Map<number, Waiter>();
  private readonly successes = new Map<string, number>();

  constructor(options: TokenBinOptions) {
    const { clock, capacity, refillPerMs } = options;
    const maxDebt = options.maxDebt ?? 0;
    const maxQueue = options.maxQueue ?? 16;

    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new InvalidConfigError(
        `capacity must be an integer >= 1, got ${capacity}`,
      );
    }
    if (!Number.isInteger(refillPerMs) || refillPerMs < 1) {
      throw new InvalidConfigError(
        `refillPerMs must be an integer >= 1, got ${refillPerMs}`,
      );
    }
    if (!Number.isFinite(maxDebt) || maxDebt < 0) {
      throw new InvalidConfigError(`maxDebt must be >= 0, got ${maxDebt}`);
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 1) {
      throw new InvalidConfigError(
        `maxQueue must be an integer >= 1, got ${maxQueue}`,
      );
    }

    this.clock = clock;
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.maxDebt = maxDebt;
    this.maxQueue = maxQueue;
    this.tokensNow = capacity;
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed > 0) {
      this.tokensNow = Math.min(
        this.capacity,
        this.tokensNow + elapsed * this.refillPerMs,
      );
      this.lastRefillAt = now;
    }
  }

  private sortedWaiters(): Waiter[] {
    return [...this.waiters.values()].sort((a, b) => {
      const sa = this.successes.get(a.key) ?? 0;
      const sb = this.successes.get(b.key) ?? 0;
      if (sa !== sb) return sa - sb;
      if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
      return a.ticket - b.ticket;
    });
  }

  request(key: string, cost: number): RequestResult {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidRequestError("key must be a non-empty string");
    }
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidRequestError(`cost must be an integer >= 1, got ${cost}`);
    }

    this.refill();

    if (this.tokensNow - cost >= -this.maxDebt) {
      this.tokensNow -= cost;
      this.successes.set(key, (this.successes.get(key) ?? 0) + 1);
      return { status: "ok" };
    }

    if (this.waiters.size < this.maxQueue) {
      const ticket = this.nextTicket++;
      this.waiters.set(ticket, {
        ticket,
        key,
        cost,
        enqueuedAt: this.clock.now(),
      });
      return { status: "queued", ticket };
    }

    return { status: "rejected" };
  }

  cancel(ticket: number): boolean {
    if (!Number.isInteger(ticket) || ticket < 1 || ticket >= this.nextTicket) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return this.waiters.delete(ticket);
  }

  drive(): { granted: number[] } {
    this.refill();
    const granted: number[] = [];
    for (;;) {
      const head = this.sortedWaiters()[0];
      if (head === undefined) break;
      if (this.tokensNow - head.cost < -this.maxDebt) break;
      this.tokensNow -= head.cost;
      this.waiters.delete(head.ticket);
      this.successes.set(head.key, (this.successes.get(head.key) ?? 0) + 1);
      granted.push(head.ticket);
    }
    return { granted };
  }

  tokens(): number {
    this.refill();
    return this.tokensNow;
  }

  waitingTickets(): number[] {
    return this.sortedWaiters().map((w) => w.ticket);
  }

  successCount(key: string): number {
    return this.successes.get(key) ?? 0;
  }

  queueLength(): number {
    return this.waiters.size;
  }
}
