import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
  InvalidRangeError,
  UnknownTicketError,
} from "./errors.js";

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

interface Hold {
  start: number;
  end: number;
}

interface Waiter {
  id: string;
  ticket: number;
  start: number;
  end: number;
}

const DEFAULT_MAX_LEASES = 16;
const DEFAULT_MAX_WAITERS = 8;

function validateCapacity(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1`);
  }
}

export class SpanLease {
  private readonly clock: VirtualClock;
  private readonly maxLeases: number;
  private readonly maxWaiters: number;
  private readonly holds = new Map<string, Hold>();
  private readonly waiters: Waiter[] = [];
  private nextTicket = 1;

  constructor(options: SpanLeaseOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      !(options.clock instanceof VirtualClock)
    ) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    const maxLeases = options.maxLeases ?? DEFAULT_MAX_LEASES;
    const maxWaiters = options.maxWaiters ?? DEFAULT_MAX_WAITERS;
    validateCapacity(maxLeases, "maxLeases");
    validateCapacity(maxWaiters, "maxWaiters");
    this.clock = options.clock;
    this.maxLeases = maxLeases;
    this.maxWaiters = maxWaiters;
  }

  acquire(id: string, start: number, end: number): AcquireResult {
    this.assertValidId(id);
    this.assertValidRange(start, end);
    if (this.holds.has(id) || this.waiters.some((w) => w.id === id)) {
      throw new DuplicateIdError(`id "${id}" is already registered`);
    }
    if (!this.overlapsActiveHold(start, end)) {
      if (this.holds.size >= this.maxLeases) {
        throw new CapacityError("maxLeases reached");
      }
      this.holds.set(id, { start, end });
      return { status: "granted" };
    }
    if (this.waiters.length >= this.maxWaiters) {
      throw new CapacityError("maxWaiters reached");
    }
    const ticket = this.nextTicket++;
    this.waiters.push({ id, ticket, start, end });
    return { status: "waiting", ticket };
  }

  release(id: string): boolean {
    this.assertValidId(id);
    if (!this.holds.delete(id)) {
      return false;
    }
    this.promoteWaiters();
    return true;
  }

  cancelWait(ticket: number): boolean {
    if (!Number.isInteger(ticket) || ticket < 1 || ticket >= this.nextTicket) {
      throw new UnknownTicketError(`unknown ticket ${String(ticket)}`);
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
    for (const [id, hold] of this.holds) {
      if (now >= hold.end) {
        expired.push(id);
      }
    }
    for (const id of expired) {
      this.holds.delete(id);
    }
    const granted = this.promoteWaiters();
    return { expired, granted };
  }

  ids(): string[] {
    return [...this.holds.keys()];
  }

  activeIds(): string[] {
    const now = this.clock.now();
    const result: string[] = [];
    for (const [id, hold] of this.holds) {
      if (now < hold.end) {
        result.push(id);
      }
    }
    return result;
  }

  waitingTickets(): number[] {
    return this.waiters.map((w) => w.ticket);
  }

  size(): number {
    return this.holds.size;
  }

  rangeOf(id: string): { start: number; end: number } | null {
    this.assertValidId(id);
    const hold = this.holds.get(id);
    if (hold === undefined) {
      return null;
    }
    return { start: hold.start, end: hold.end };
  }

  covers(t: number): string[] {
    if (!Number.isInteger(t)) {
      throw new InvalidRangeError("t must be a finite integer");
    }
    const now = this.clock.now();
    const result: string[] = [];
    for (const [id, hold] of this.holds) {
      if (now < hold.end && hold.start <= t && t < hold.end) {
        result.push(id);
      }
    }
    return result;
  }

  private overlapsActiveHold(start: number, end: number): boolean {
    const now = this.clock.now();
    for (const hold of this.holds.values()) {
      if (now < hold.end && start < hold.end && hold.start < end) {
        return true;
      }
    }
    return false;
  }

  private promoteWaiters(): Array<{ id: string; ticket: number }> {
    const granted: Array<{ id: string; ticket: number }> = [];
    while (this.waiters.length > 0) {
      if (this.holds.size >= this.maxLeases) {
        break;
      }
      const head = this.waiters[0];
      if (this.overlapsActiveHold(head.start, head.end)) {
        break;
      }
      this.waiters.shift();
      this.holds.set(head.id, { start: head.start, end: head.end });
      granted.push({ id: head.id, ticket: head.ticket });
    }
    return granted;
  }

  private assertValidId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private assertValidRange(start: number, end: number): void {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start >= end
    ) {
      throw new InvalidRangeError(
        "range must be finite integers with 0 <= start < end",
      );
    }
    if (end <= this.clock.now()) {
      throw new InvalidRangeError("range end must be greater than now");
    }
  }
}
