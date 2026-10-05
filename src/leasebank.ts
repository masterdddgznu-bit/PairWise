import { AffinityMap } from "./affinity.js";
import type { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateError,
  FenceError,
  InvalidArgError,
  InvalidConfigError,
  InvalidSlotError,
  UnknownTicketError,
} from "./errors.js";
import { SlotTable } from "./slots.js";
import { WaitQueue } from "./waiters.js";

export interface LeaseBankOptions {
  clock: VirtualClock;
  slots: number;
  leaseMs: number;
  maxWaiters?: number;
}

export type AcquireResult =
  | { status: "held"; slot: number; fence: number }
  | { status: "waiting"; ticket: number };

export interface DriveResult {
  expired: number[];
  granted: Array<{ slot: number; holder: string; fence: number }>;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class LeaseBank {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxWaiters: number;
  private readonly slots: SlotTable;
  private readonly waiters = new WaitQueue();
  private readonly affinity = new AffinityMap();
  private nextFence = 1;
  private nextTicket = 1;

  constructor(options: LeaseBankOptions) {
    if (!isPositiveInt(options.slots) || !isPositiveInt(options.leaseMs)) {
      throw new InvalidConfigError("slots and leaseMs must be integers >= 1");
    }
    const maxWaiters = options.maxWaiters ?? 8;
    if (!isPositiveInt(maxWaiters)) {
      throw new InvalidConfigError("maxWaiters must be an integer >= 1");
    }
    this.clock = options.clock;
    this.leaseMs = options.leaseMs;
    this.maxWaiters = maxWaiters;
    this.slots = new SlotTable(options.slots);
  }

  acquire(holder: string): AcquireResult {
    this.assertHolder(holder);
    if (this.holdsAnySlot(holder) || this.waiters.hasHolder(holder)) {
      throw new DuplicateError(`holder already registered: ${holder}`);
    }
    if (this.slots.hasFree()) {
      const slot = this.pickSlot(holder);
      const fence = this.nextFence++;
      this.grantSlot(slot, holder, fence);
      return { status: "held", slot, fence };
    }
    if (this.waiters.size >= this.maxWaiters) {
      throw new CapacityError("wait queue is full");
    }
    const ticket = this.nextTicket++;
    this.waiters.enqueue({ ticket, holder });
    return { status: "waiting", ticket };
  }

  renew(slot: number, holder: string, fence: number): boolean {
    this.assertSlot(slot);
    const state = this.slots.get(slot);
    if (state === null) return false;
    if (state.fence !== fence) {
      throw new FenceError(`fence mismatch on slot ${slot}`);
    }
    if (state.holder !== holder) return false;
    state.deadline = this.clock.now() + this.leaseMs;
    this.affinity.set(holder, slot);
    return true;
  }

  release(slot: number, holder: string, fence: number): boolean {
    this.assertSlot(slot);
    const state = this.slots.get(slot);
    if (state === null) return false;
    if (state.fence !== fence) {
      throw new FenceError(`fence mismatch on slot ${slot}`);
    }
    if (state.holder !== holder) return false;
    this.slots.free(slot);
    const waiter = this.waiters.dequeue();
    if (waiter !== undefined) {
      this.grantSlot(slot, waiter.holder, this.nextFence++);
    }
    return true;
  }

  cancelWait(ticket: number): boolean {
    if (!this.waiters.hasSeenTicket(ticket)) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    return this.waiters.remove(ticket);
  }

  drive(): DriveResult {
    const expired = this.slots.expiredSlots(this.clock.now());
    for (const slot of expired) {
      this.slots.free(slot);
    }
    const granted: DriveResult["granted"] = [];
    while (this.slots.hasFree() && this.waiters.size > 0) {
      const waiter = this.waiters.dequeue();
      if (waiter === undefined) break;
      const slot = this.pickSlot(waiter.holder);
      const fence = this.nextFence++;
      this.grantSlot(slot, waiter.holder, fence);
      granted.push({ slot, holder: waiter.holder, fence });
    }
    return { expired, granted };
  }

  heldSlots(): number[] {
    return this.slots.heldSlots();
  }

  holderOf(slot: number): string | null {
    this.assertSlot(slot);
    return this.slots.get(slot)?.holder ?? null;
  }

  fenceOf(slot: number): number | null {
    this.assertSlot(slot);
    return this.slots.get(slot)?.fence ?? null;
  }

  deadlineOf(slot: number): number | null {
    this.assertSlot(slot);
    return this.slots.get(slot)?.deadline ?? null;
  }

  waitingTickets(): number[] {
    return this.waiters.tickets();
  }

  waitingHolders(): string[] {
    return this.waiters.holders();
  }

  preferredSlot(holder: string): number | null {
    this.assertHolder(holder);
    return this.affinity.get(holder);
  }

  clearAffinity(holder: string): boolean {
    this.assertHolder(holder);
    return this.affinity.clear(holder);
  }

  private grantSlot(slot: number, holder: string, fence: number): void {
    this.slots.grant(slot, holder, fence, this.clock.now() + this.leaseMs);
    this.affinity.set(holder, slot);
  }

  private pickSlot(holder: string): number {
    const preferred = this.affinity.get(holder);
    if (preferred !== null && this.slots.get(preferred) === null) {
      return preferred;
    }
    return this.slots.lowestFree();
  }

  private holdsAnySlot(holder: string): boolean {
    return this.slots
      .heldSlots()
      .some((slot) => this.slots.get(slot)?.holder === holder);
  }

  private assertHolder(holder: unknown): asserts holder is string {
    if (typeof holder !== "string" || holder.length === 0) {
      throw new InvalidArgError("holder must be a non-empty string");
    }
  }

  private assertSlot(slot: number): void {
    if (!this.slots.isValidSlot(slot)) {
      throw new InvalidSlotError(`invalid slot: ${slot}`);
    }
  }
}
