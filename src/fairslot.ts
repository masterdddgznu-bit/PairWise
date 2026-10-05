import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidRequestError,
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

export type RequestResult =
  | { status: "granted"; fence: number; slot: number }
  | { status: "waiting"; ticket: number };

interface Holding {
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

function requireAtLeast(name: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    throw new InvalidConfigError(`${name} must be a finite number >= ${min}`);
  }
}

export class FairSlot {
  private readonly clock: VirtualClock;
  private readonly slotCount: number;
  private readonly leaseMs: number;
  private readonly ageEveryMs: number;
  private readonly ageBump: number;
  private readonly skipAfterMs: number;
  private readonly maxWaiters: number;

  private nextFence = 1;
  private nextTicket = 1;

  private readonly holdingsByFence = new Map<number, Holding>();
  private readonly fenceBySlot = new Map<number, number>();
  private readonly fenceByHolder = new Map<string, number>();
  private readonly waitersByTicket = new Map<number, Waiter>();
  private readonly ticketByHolder = new Map<string, number>();

  constructor(options: FairSlotOptions) {
    requireAtLeast("slots", options.slots, 1);
    requireAtLeast("leaseMs", options.leaseMs, 1);
    requireAtLeast("ageEveryMs", options.ageEveryMs, 1);
    requireAtLeast("ageBump", options.ageBump, 1);
    requireAtLeast("skipAfterMs", options.skipAfterMs, 1);
    if (!Number.isInteger(options.slots)) {
      throw new InvalidConfigError("slots must be an integer");
    }
    const maxWaiters = options.maxWaiters ?? 16;
    requireAtLeast("maxWaiters", maxWaiters, 1);
    if (!Number.isInteger(maxWaiters)) {
      throw new InvalidConfigError("maxWaiters must be an integer");
    }

    this.clock = options.clock;
    this.slotCount = options.slots;
    this.leaseMs = options.leaseMs;
    this.ageEveryMs = options.ageEveryMs;
    this.ageBump = options.ageBump;
    this.skipAfterMs = options.skipAfterMs;
    this.maxWaiters = maxWaiters;
  }

  request(
    holderId: string,
    opts: { basePriority?: number } = {},
  ): RequestResult {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidRequestError("holderId must be a non-empty string");
    }
    const basePriority = opts.basePriority ?? 0;
    if (!Number.isFinite(basePriority)) {
      throw new InvalidRequestError("basePriority must be a finite number");
    }
    if (this.fenceByHolder.has(holderId)) {
      throw new InvalidRequestError(
        `holder ${holderId} already holds a slot`,
      );
    }
    if (this.ticketByHolder.has(holderId)) {
      throw new InvalidRequestError(
        `holder ${holderId} is already waiting`,
      );
    }

    const freeSlot = this.lowestFreeSlot();
    if (freeSlot !== undefined) {
      const fence = this.grant(holderId, freeSlot);
      return { status: "granted", fence, slot: freeSlot };
    }

    if (this.waitersByTicket.size >= this.maxWaiters) {
      throw new InvalidRequestError("waiting queue is full");
    }
    const now = this.clock.now();
    const ticket = this.nextTicket++;
    const waiter: Waiter = {
      holderId,
      ticket,
      basePriority,
      ageBoost: 0,
      enqueuedAt: now,
      lastAgeAt: now,
    };
    this.waitersByTicket.set(ticket, waiter);
    this.ticketByHolder.set(holderId, ticket);
    return { status: "waiting", ticket };
  }

  heartbeat(holderId: string, fence: number): boolean {
    const holding = this.holdingsByFence.get(fence);
    if (holding === undefined) {
      return false;
    }
    if (holding.holderId !== holderId) {
      throw new FenceError(
        `fence ${fence} is not held by ${holderId}`,
      );
    }
    holding.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(holderId: string, fence: number): boolean {
    const holding = this.holdingsByFence.get(fence);
    if (holding === undefined) {
      return false;
    }
    if (holding.holderId !== holderId) {
      throw new FenceError(
        `fence ${fence} is not held by ${holderId}`,
      );
    }
    this.removeHolding(holding);
    this.promote();
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const waiter = this.waitersByTicket.get(ticket);
    if (waiter === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (waiter.holderId !== holderId) {
      return false;
    }
    this.waitersByTicket.delete(ticket);
    this.ticketByHolder.delete(holderId);
    return true;
  }

  drive(): { expiredFences: number[] } {
    const now = this.clock.now();

    const expiredFences: number[] = [];
    for (const holding of [...this.holdingsByFence.values()]) {
      if (now >= holding.leaseDeadline) {
        this.removeHolding(holding);
        expiredFences.push(holding.fence);
      }
    }
    expiredFences.sort((a, b) => a - b);

    for (const waiter of this.waitersByTicket.values()) {
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
    return fence === undefined
      ? undefined
      : this.holdingsByFence.get(fence)?.holderId;
  }

  fenceOfSlot(slot: number): number | undefined {
    return this.fenceBySlot.get(slot);
  }

  slotOf(holderId: string): number | undefined {
    const fence = this.fenceByHolder.get(holderId);
    return fence === undefined
      ? undefined
      : this.holdingsByFence.get(fence)?.slot;
  }

  waitingTickets(): number[] {
    return this.orderedWaiters().map((waiter) => waiter.ticket);
  }

  effectivePriorityOf(ticket: number): number {
    const waiter = this.waitersByTicket.get(ticket);
    if (waiter === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return waiter.basePriority + waiter.ageBoost;
  }

  private lowestFreeSlot(): number | undefined {
    for (let slot = 0; slot < this.slotCount; slot++) {
      if (!this.fenceBySlot.has(slot)) {
        return slot;
      }
    }
    return undefined;
  }

  private grant(holderId: string, slot: number): number {
    const fence = this.nextFence++;
    const holding: Holding = {
      holderId,
      fence,
      slot,
      leaseDeadline: this.clock.now() + this.leaseMs,
    };
    this.holdingsByFence.set(fence, holding);
    this.fenceBySlot.set(slot, fence);
    this.fenceByHolder.set(holderId, fence);
    return fence;
  }

  private removeHolding(holding: Holding): void {
    this.holdingsByFence.delete(holding.fence);
    this.fenceBySlot.delete(holding.slot);
    this.fenceByHolder.delete(holding.holderId);
  }

  private orderedWaiters(): Waiter[] {
    return [...this.waitersByTicket.values()].sort(
      (a, b) =>
        b.basePriority + b.ageBoost - (a.basePriority + a.ageBoost) ||
        a.enqueuedAt - b.enqueuedAt ||
        a.ticket - b.ticket,
    );
  }

  private promote(): void {
    const now = this.clock.now();
    while (this.waitersByTicket.size > 0) {
      const freeSlot = this.lowestFreeSlot();
      if (freeSlot === undefined) {
        return;
      }
      const ordered = this.orderedWaiters();
      let candidate = ordered[0];
      if (
        ordered.length > 1 &&
        now - candidate.enqueuedAt >= this.skipAfterMs
      ) {
        candidate = ordered[1];
      }
      this.waitersByTicket.delete(candidate.ticket);
      this.ticketByHolder.delete(candidate.holderId);
      this.grant(candidate.holderId, freeSlot);
    }
  }
}
