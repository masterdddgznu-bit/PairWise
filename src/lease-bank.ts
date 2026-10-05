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
import { AffinityMap } from "./affinity.js";

export interface LeaseBankConfig {
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

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
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

  constructor(config: LeaseBankConfig) {
    if (
      config === null ||
      typeof config !== "object" ||
      config.clock === null ||
      typeof config.clock !== "object" ||
      typeof config.clock.now !== "function"
    ) {
      throw new InvalidConfigError("config.clock must be a VirtualClock");
    }
    if (!isPositiveInt(config.slots)) {
      throw new InvalidConfigError("slots must be an integer >= 1");
    }
    if (!isPositiveInt(config.leaseMs)) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    const maxWaiters = config.maxWaiters ?? 8;
    if (!isPositiveInt(maxWaiters)) {
      throw new InvalidConfigError("maxWaiters must be an integer >= 1");
    }
    this.clock = config.clock;
    this.slots = new SlotTable(config.slots);
    this.leaseMs = config.leaseMs;
    this.maxWaiters = maxWaiters;
  }

  private static checkHolder(holder: unknown): asserts holder is string {
    if (typeof holder !== "string" || holder.length === 0) {
      throw new InvalidArgError("holder must be a non-empty string");
    }
  }

  private checkSlot(slot: unknown): asserts slot is number {
    if (typeof slot !== "number" || !this.slots.isValid(slot)) {
      throw new InvalidSlotError(`invalid slot: ${String(slot)}`);
    }
  }

  private pickSlot(holder: string): number {
    const preferred = this.affinity.get(holder);
    if (preferred !== null && this.slots.get(preferred) === null) {
      return preferred;
    }
    const free = this.slots.firstFree();
    if (free === null) {
      throw new Error("unreachable: no free slot");
    }
    return free;
  }

  private grantSlot(slot: number, holder: string): number {
    const fence = this.nextFence++;
    this.slots.grant(slot, holder, fence, this.clock.now() + this.leaseMs);
    this.affinity.set(holder, slot);
    return fence;
  }

  acquire(holder: string): AcquireResult {
    LeaseBank.checkHolder(holder);
    if (this.slots.slotOfHolder(holder) !== null) {
      throw new DuplicateError(`holder already holds a slot: ${holder}`);
    }
    if (this.waiters.hasHolder(holder)) {
      throw new DuplicateError(`holder already waiting: ${holder}`);
    }
    if (this.slots.firstFree() !== null) {
      const slot = this.pickSlot(holder);
      const fence = this.grantSlot(slot, holder);
      return { status: "held", slot, fence };
    }
    if (this.waiters.size >= this.maxWaiters) {
      throw new CapacityError("wait queue is full");
    }
    const ticket = this.nextTicket++;
    this.waiters.enqueue(ticket, holder);
    return { status: "waiting", ticket };
  }

  renew(slot: number, holder: string, fence: number): boolean {
    this.checkSlot(slot);
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
    this.checkSlot(slot);
    const state = this.slots.get(slot);
    if (state === null) return false;
    if (state.fence !== fence) {
      throw new FenceError(`fence mismatch on slot ${slot}`);
    }
    if (state.holder !== holder) return false;
    this.slots.free(slot);
    const head = this.waiters.dequeue();
    if (head !== undefined) {
      this.grantSlot(slot, head.holder);
    }
    return true;
  }

  cancelWait(ticket: number): boolean {
    if (typeof ticket !== "number" || !this.waiters.hasTicket(ticket)) {
      throw new UnknownTicketError(`unknown ticket: ${String(ticket)}`);
    }
    return this.waiters.remove(ticket);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expired = this.slots.expiredSlots(now);
    for (const slot of expired) {
      this.slots.free(slot);
    }
    const granted: DriveResult["granted"] = [];
    while (this.slots.firstFree() !== null && this.waiters.size > 0) {
      const head = this.waiters.dequeue();
      if (head === undefined) break;
      const slot = this.pickSlot(head.holder);
      const fence = this.grantSlot(slot, head.holder);
      granted.push({ slot, holder: head.holder, fence });
    }
    return { expired, granted };
  }

  heldSlots(): number[] {
    return this.slots.heldSlots();
  }

  holderOf(slot: number): string | null {
    this.checkSlot(slot);
    return this.slots.get(slot)?.holder ?? null;
  }

  fenceOf(slot: number): number | null {
    this.checkSlot(slot);
    return this.slots.get(slot)?.fence ?? null;
  }

  deadlineOf(slot: number): number | null {
    this.checkSlot(slot);
    return this.slots.get(slot)?.deadline ?? null;
  }

  waitingTickets(): number[] {
    return this.waiters.tickets();
  }

  waitingHolders(): string[] {
    return this.waiters.holders();
  }

  preferredSlot(holder: string): number | null {
    LeaseBank.checkHolder(holder);
    return this.affinity.get(holder);
  }

  clearAffinity(holder: string): boolean {
    LeaseBank.checkHolder(holder);
    return this.affinity.clear(holder);
  }
}
