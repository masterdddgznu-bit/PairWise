import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidRequestError,
  FenceError,
  UnknownTicketError,
} from "./errors.js";

export interface FairSlotOptions {
  clock: VirtualClock;
  slots: number;
  leaseMs: number;
  ageEveryMs: number;
  ageBump: number;
  skipAfterMs: number;
  maxWaiters?: number;
}

export interface RequestOptions {
  basePriority?: number;
}

export type RequestResult =
  | { status: "granted"; fence: number; slot: number }
  | { status: "waiting"; ticket: number };

export interface DriveResult {
  expiredFences: number[];
}

interface Held {
  holderId: string;
  fence: number;
  slot: number;
  leaseDeadline: number;
}

interface Waiter {
  holderId: string;
  ticket: number;
  basePriority: number;
  ageBoost: number;
  enqueuedAt: number;
  lastAgeAt: number;
}

function effectivePriority(w: Waiter): number {
  return w.basePriority + w.ageBoost;
}

function compareWaiters(a: Waiter, b: Waiter): number {
  const pa = effectivePriority(a);
  const pb = effectivePriority(b);
  if (pa !== pb) return pb - pa;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
  return a.ticket - b.ticket;
}

export class FairSlot {
  private readonly clock: VirtualClock;
  private readonly slots: number;
  private readonly leaseMs: number;
  private readonly ageEveryMs: number;
  private readonly ageBump: number;
  private readonly skipAfterMs: number;
  private readonly maxWaiters: number;

  private nextFence = 1;
  private nextTicket = 1;
  private readonly heldByFence = new Map<number, Held>();
  private readonly fenceBySlot = new Map<number, number>();
  private readonly fenceByHolder = new Map<string, number>();
  private readonly waiters = new Map<number, Waiter>();
  private readonly ticketByHolder = new Map<string, number>();

  constructor(opts: FairSlotOptions) {
    const maxWaiters = opts.maxWaiters ?? 16;
    const checks: Array<[string, number]> = [
      ["slots", opts.slots],
      ["leaseMs", opts.leaseMs],
      ["ageEveryMs", opts.ageEveryMs],
      ["ageBump", opts.ageBump],
      ["skipAfterMs", opts.skipAfterMs],
      ["maxWaiters", maxWaiters],
    ];
    for (const [name, value] of checks) {
      if (!Number.isFinite(value) || value < 1) {
        throw new InvalidConfigError(
          `${name} must be a finite number >= 1, got ${value}`,
        );
      }
    }
    this.clock = opts.clock;
    this.slots = opts.slots;
    this.leaseMs = opts.leaseMs;
    this.ageEveryMs = opts.ageEveryMs;
    this.ageBump = opts.ageBump;
    this.skipAfterMs = opts.skipAfterMs;
    this.maxWaiters = maxWaiters;
  }

  request(holderId: string, opts: RequestOptions = {}): RequestResult {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidRequestError("holderId must be a non-empty string");
    }
    if (this.fenceByHolder.has(holderId)) {
      throw new InvalidRequestError(`holder "${holderId}" already holds a slot`);
    }
    if (this.ticketByHolder.has(holderId)) {
      throw new InvalidRequestError(`holder "${holderId}" is already waiting`);
    }
    const basePriority = opts.basePriority ?? 0;
    if (!Number.isFinite(basePriority)) {
      throw new InvalidRequestError(
        `basePriority must be finite, got ${basePriority}`,
      );
    }

    const freeSlot = this.lowestFreeSlot();
    if (freeSlot !== undefined) {
      const fence = this.nextFence++;
      const held: Held = {
        holderId,
        fence,
        slot: freeSlot,
        leaseDeadline: this.clock.now() + this.leaseMs,
      };
      this.heldByFence.set(fence, held);
      this.fenceBySlot.set(freeSlot, fence);
      this.fenceByHolder.set(holderId, fence);
      return { status: "granted", fence, slot: freeSlot };
    }

    if (this.waiters.size >= this.maxWaiters) {
      throw new InvalidRequestError("waiting queue is full");
    }
    const ticket = this.nextTicket++;
    const now = this.clock.now();
    const waiter: Waiter = {
      holderId,
      ticket,
      basePriority,
      ageBoost: 0,
      enqueuedAt: now,
      lastAgeAt: now,
    };
    this.waiters.set(ticket, waiter);
    this.ticketByHolder.set(holderId, ticket);
    return { status: "waiting", ticket };
  }

  heartbeat(holderId: string, fence: number): boolean {
    const held = this.matchHeld(holderId, fence);
    if (held === undefined) return false;
    held.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(holderId: string, fence: number): boolean {
    const held = this.matchHeld(holderId, fence);
    if (held === undefined) return false;
    this.removeHeld(held);
    this.promote();
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const waiter = this.waiters.get(ticket);
    if (waiter === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (waiter.holderId !== holderId) return false;
    this.waiters.delete(ticket);
    this.ticketByHolder.delete(holderId);
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expiredFences: number[] = [];
    for (const held of [...this.heldByFence.values()]) {
      if (now >= held.leaseDeadline) {
        expiredFences.push(held.fence);
        this.removeHeld(held);
      }
    }
    expiredFences.sort((a, b) => a - b);

    for (const waiter of this.waiters.values()) {
      const elapsed = now - waiter.lastAgeAt;
      if (elapsed >= this.ageEveryMs) {
        const cycles = Math.floor(elapsed / this.ageEveryMs);
        waiter.ageBoost += this.ageBump * cycles;
        waiter.lastAgeAt += cycles * this.ageEveryMs;
      }
    }

    this.promote();
    return { expiredFences };
  }

  holderOfSlot(slot: number): string | undefined {
    const fence = this.fenceBySlot.get(slot);
    if (fence === undefined) return undefined;
    return this.heldByFence.get(fence)?.holderId;
  }

  fenceOfSlot(slot: number): number | undefined {
    return this.fenceBySlot.get(slot);
  }

  slotOf(holderId: string): number | undefined {
    const fence = this.fenceByHolder.get(holderId);
    if (fence === undefined) return undefined;
    return this.heldByFence.get(fence)?.slot;
  }

  waitingTickets(): number[] {
    return this.orderedWaiters().map((w) => w.ticket);
  }

  effectivePriorityOf(ticket: number): number {
    const waiter = this.waiters.get(ticket);
    if (waiter === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return effectivePriority(waiter);
  }

  private matchHeld(holderId: string, fence: number): Held | undefined {
    const held = this.heldByFence.get(fence);
    if (held === undefined) return undefined;
    if (held.holderId !== holderId) {
      throw new FenceError(
        `fence ${fence} does not belong to holder "${holderId}"`,
      );
    }
    return held;
  }

  private removeHeld(held: Held): void {
    this.heldByFence.delete(held.fence);
    this.fenceBySlot.delete(held.slot);
    this.fenceByHolder.delete(held.holderId);
  }

  private lowestFreeSlot(): number | undefined {
    for (let slot = 0; slot < this.slots; slot++) {
      if (!this.fenceBySlot.has(slot)) return slot;
    }
    return undefined;
  }

  private orderedWaiters(): Waiter[] {
    return [...this.waiters.values()].sort(compareWaiters);
  }

  private grantTo(waiter: Waiter): void {
    const slot = this.lowestFreeSlot();
    if (slot === undefined) return;
    this.waiters.delete(waiter.ticket);
    this.ticketByHolder.delete(waiter.holderId);
    const fence = this.nextFence++;
    const held: Held = {
      holderId: waiter.holderId,
      fence,
      slot,
      leaseDeadline: this.clock.now() + this.leaseMs,
    };
    this.heldByFence.set(fence, held);
    this.fenceBySlot.set(slot, fence);
    this.fenceByHolder.set(waiter.holderId, fence);
  }

  private promote(): void {
    const now = this.clock.now();
    while (this.lowestFreeSlot() !== undefined && this.waiters.size > 0) {
      const ordered = this.orderedWaiters();
      const head = ordered[0];
      let pick = head;
      if (ordered.length > 1 && now - head.enqueuedAt >= this.skipAfterMs) {
        pick = ordered[1];
      }
      this.grantTo(pick);
    }
  }
}
