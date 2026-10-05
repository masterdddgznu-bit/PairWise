export class TokenBinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TokenBinError {}
export class InvalidRequestError extends TokenBinError {}
export class UnknownTicketError extends TokenBinError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new TokenBinError("advance requires a non-negative finite ms");
    }
    this.current += ms;
  }
}

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

function isPositiveInt(v: number): boolean {
  return Number.isInteger(v) && v >= 1;
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
    if (!isPositiveInt(capacity)) {
      throw new InvalidConfigError("capacity must be an integer >= 1");
    }
    if (!isPositiveInt(refillPerMs)) {
      throw new InvalidConfigError("refillPerMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxDebt) || maxDebt < 0) {
      throw new InvalidConfigError("maxDebt must be an integer >= 0");
    }
    if (!isPositiveInt(maxQueue)) {
      throw new InvalidConfigError("maxQueue must be an integer >= 1");
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

  private successOf(key: string): number {
    return this.successes.get(key) ?? 0;
  }

  private sortedWaiters(): Waiter[] {
    return [...this.waiters.values()].sort((a, b) => {
      const bySuccess = this.successOf(a.key) - this.successOf(b.key);
      if (bySuccess !== 0) return bySuccess;
      if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
      return a.ticket - b.ticket;
    });
  }

  request(key: string, cost: number): RequestResult {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidRequestError("key must be a non-empty string");
    }
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidRequestError("cost must be an integer >= 1");
    }
    this.refill();
    if (this.tokensNow - cost >= -this.maxDebt) {
      this.tokensNow -= cost;
      this.successes.set(key, this.successOf(key) + 1);
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
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
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
      this.successes.set(head.key, this.successOf(head.key) + 1);
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
    return this.successOf(key);
  }

  queueLength(): number {
    return this.waiters.size;
  }
}
