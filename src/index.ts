export class SpanLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SpanLeaseError {}
export class InvalidIdError extends SpanLeaseError {}
export class InvalidRangeError extends SpanLeaseError {}
export class DuplicateIdError extends SpanLeaseError {}
export class CapacityError extends SpanLeaseError {}
export class UnknownTicketError extends SpanLeaseError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new InvalidConfigError(`advance requires a finite ms >= 0, got ${ms}`);
    }
    this.current += ms;
  }
}

interface Span {
  start: number;
  end: number;
}

interface Holder extends Span {
  id: string;
}

interface Waiter extends Span {
  id: string;
  ticket: number;
}

export interface SpanLeaseOptions {
  clock: VirtualClock;
  maxLeases?: number;
  maxWaiters?: number;
}

export type AcquireResult =
  | { status: "granted" }
  | { status: "waiting"; ticket: number };

export interface DriveResult {
  expired: string[];
  granted: Array<{ id: string; ticket: number }>;
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export class SpanLease {
  private readonly clock: VirtualClock;
  private readonly maxLeases: number;
  private readonly maxWaiters: number;
  private readonly holders: Holder[] = [];
  private readonly waiters: Waiter[] = [];
  private nextTicket = 1;

  constructor(options: SpanLeaseOptions) {
    this.clock = options.clock;
    this.maxLeases = options.maxLeases ?? 16;
    this.maxWaiters = options.maxWaiters ?? 8;
    if (!Number.isInteger(this.maxLeases) || this.maxLeases < 1) {
      throw new InvalidConfigError(`maxLeases must be an integer >= 1, got ${this.maxLeases}`);
    }
    if (!Number.isInteger(this.maxWaiters) || this.maxWaiters < 1) {
      throw new InvalidConfigError(`maxWaiters must be an integer >= 1, got ${this.maxWaiters}`);
    }
  }

  acquire(id: string, start: number, end: number): AcquireResult {
    if (!isValidId(id)) {
      throw new InvalidIdError(`id must be a non-empty string, got ${String(id)}`);
    }
    this.assertValidRange(start, end);
    if (
      this.holders.some((h) => h.id === id) ||
      this.waiters.some((w) => w.id === id)
    ) {
      throw new DuplicateIdError(`id already registered: ${id}`);
    }
    const span: Span = { start, end };
    const blocked = this.holders.some(
      (h) => this.clock.now() < h.end && overlaps(h, span),
    );
    if (!blocked) {
      if (this.holders.length >= this.maxLeases) {
        throw new CapacityError(`maxLeases reached: ${this.maxLeases}`);
      }
      this.holders.push({ id, start, end });
      return { status: "granted" };
    }
    if (this.waiters.length >= this.maxWaiters) {
      throw new CapacityError(`maxWaiters reached: ${this.maxWaiters}`);
    }
    const ticket = this.nextTicket++;
    this.waiters.push({ id, start, end, ticket });
    return { status: "waiting", ticket };
  }

  release(id: string): boolean {
    if (!isValidId(id)) {
      throw new InvalidIdError(`id must be a non-empty string, got ${String(id)}`);
    }
    const index = this.holders.findIndex((h) => h.id === id);
    if (index === -1) {
      return false;
    }
    this.holders.splice(index, 1);
    this.promote();
    return true;
  }

  cancelWait(ticket: number): boolean {
    if (!Number.isInteger(ticket) || ticket < 1 || ticket >= this.nextTicket) {
      throw new UnknownTicketError(`unknown ticket: ${String(ticket)}`);
    }
    const index = this.waiters.findIndex((w) => w.ticket === ticket);
    if (index === -1) {
      return false;
    }
    this.waiters.splice(index, 1);
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expired: string[] = [];
    for (let i = this.holders.length - 1; i >= 0; i--) {
      if (now >= this.holders[i].end) {
        expired.unshift(this.holders[i].id);
        this.holders.splice(i, 1);
      }
    }
    const granted = this.promote();
    return { expired, granted };
  }

  ids(): string[] {
    return this.holders.map((h) => h.id);
  }

  activeIds(): string[] {
    const now = this.clock.now();
    return this.holders.filter((h) => now < h.end).map((h) => h.id);
  }

  waitingTickets(): number[] {
    return this.waiters.map((w) => w.ticket);
  }

  size(): number {
    return this.holders.length;
  }

  rangeOf(id: string): { start: number; end: number } | null {
    if (!isValidId(id)) {
      throw new InvalidIdError(`id must be a non-empty string, got ${String(id)}`);
    }
    const holder = this.holders.find((h) => h.id === id);
    if (!holder) {
      return null;
    }
    return { start: holder.start, end: holder.end };
  }

  covers(t: number): string[] {
    if (!Number.isInteger(t)) {
      throw new InvalidRangeError(`t must be a finite integer, got ${String(t)}`);
    }
    const now = this.clock.now();
    return this.holders
      .filter((h) => now < h.end && h.start <= t && t < h.end)
      .map((h) => h.id);
  }

  private assertValidRange(start: number, end: number): void {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start >= end ||
      end <= this.clock.now()
    ) {
      throw new InvalidRangeError(
        `invalid range [${String(start)}, ${String(end)}) at now=${this.clock.now()}`,
      );
    }
  }

  private promote(): Array<{ id: string; ticket: number }> {
    const granted: Array<{ id: string; ticket: number }> = [];
    while (this.waiters.length > 0 && this.holders.length < this.maxLeases) {
      const head = this.waiters[0];
      const now = this.clock.now();
      const blocked = this.holders.some(
        (h) => now < h.end && overlaps(h, head),
      );
      if (blocked) {
        break;
      }
      this.waiters.shift();
      this.holders.push({ id: head.id, start: head.start, end: head.end });
      granted.push({ id: head.id, ticket: head.ticket });
    }
    return granted;
  }
}
