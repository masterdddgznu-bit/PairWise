import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownItemError,
  UnknownSlotError,
} from "./errors.js";

export interface SlotFillOptions {
  clock: VirtualClock;
  slotMs: number;
  maxPerSlot: number;
  maxSealed?: number;
}

type SlotStatus = "open" | "sealed" | "drained";

interface Slot {
  id: number;
  start: number;
  end: number;
  status: SlotStatus;
  itemIds: number[];
}

interface Item {
  id: number;
  slotId: number;
  payload: unknown;
  taken: boolean;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export class SlotFill {
  private readonly clock: VirtualClock;
  private readonly slotMs: number;
  private readonly maxPerSlot: number;
  private readonly maxSealed: number;

  private readonly slots = new Map<number, Slot>();
  private readonly items = new Map<number, Item>();
  private currentSlotId = 1;
  private nextItemId = 1;
  private sealedCount = 0;

  constructor(options: SlotFillOptions) {
    const { clock, slotMs, maxPerSlot } = options;
    const maxSealed = options.maxSealed ?? 8;
    if (
      !isPositiveInteger(slotMs) ||
      !isPositiveInteger(maxPerSlot) ||
      !isPositiveInteger(maxSealed)
    ) {
      throw new InvalidConfigError(
        "slotMs, maxPerSlot and maxSealed must be integers >= 1",
      );
    }
    this.clock = clock;
    this.slotMs = slotMs;
    this.maxPerSlot = maxPerSlot;
    this.maxSealed = maxSealed;
    this.slots.set(1, {
      id: 1,
      start: 0,
      end: slotMs,
      status: "open",
      itemIds: [],
    });
  }

  submit(payload: unknown): { slotId: number; itemId: number } {
    const slot = this.openSlot();
    if (slot.itemIds.length >= this.maxPerSlot) {
      throw new CapacityError(`slot ${slot.id} is full`);
    }
    const itemId = this.nextItemId++;
    slot.itemIds.push(itemId);
    this.items.set(itemId, {
      id: itemId,
      slotId: slot.id,
      payload,
      taken: false,
    });
    return { slotId: slot.id, itemId };
  }

  seal(): { slotId: number } {
    const slot = this.openSlot();
    const becomesSealed = slot.itemIds.length > 0;
    if (becomesSealed && this.sealedCount + 1 > this.maxSealed) {
      throw new CapacityError("maxSealed limit reached");
    }
    if (becomesSealed) {
      slot.status = "sealed";
      this.sealedCount += 1;
    } else {
      slot.status = "drained";
    }
    const nextId = slot.id + 1;
    this.slots.set(nextId, {
      id: nextId,
      start: slot.end,
      end: slot.end + this.slotMs,
      status: "open",
      itemIds: [],
    });
    this.currentSlotId = nextId;
    return { slotId: slot.id };
  }

  drive(): { sealed: number | null } {
    const slot = this.openSlot();
    if (this.clock.now() < slot.end) {
      return { sealed: null };
    }
    try {
      return { sealed: this.seal().slotId };
    } catch (err) {
      if (err instanceof CapacityError) {
        return { sealed: null };
      }
      throw err;
    }
  }

  take(): { slotId: number; itemId: number; payload: unknown } | null {
    let target: Slot | null = null;
    for (const slot of this.slots.values()) {
      if (
        slot.status === "sealed" &&
        (target === null || slot.id < target.id)
      ) {
        target = slot;
      }
    }
    if (target === null) {
      return null;
    }
    const itemId = target.itemIds.shift()!;
    const item = this.items.get(itemId)!;
    item.taken = true;
    if (target.itemIds.length === 0) {
      target.status = "drained";
      this.sealedCount -= 1;
    }
    return { slotId: target.id, itemId, payload: item.payload };
  }

  cancel(itemId: number): boolean {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    const slot = this.slots.get(item.slotId)!;
    if (slot.status !== "open" || item.taken) {
      return false;
    }
    const index = slot.itemIds.indexOf(itemId);
    if (index === -1) {
      return false;
    }
    slot.itemIds.splice(index, 1);
    return true;
  }

  currentSlot(): number {
    return this.currentSlotId;
  }

  statusOfSlot(slotId: number): SlotStatus {
    const slot = this.slots.get(slotId);
    if (slot === undefined) {
      throw new UnknownSlotError(`unknown slot ${slotId}`);
    }
    return slot.status;
  }

  openIds(): number[] {
    return [...this.openSlot().itemIds];
  }

  readyCount(): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.status === "sealed") {
        count += slot.itemIds.length;
      }
    }
    return count;
  }

  slotOf(itemId: number): number {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    return item.slotId;
  }

  private openSlot(): Slot {
    return this.slots.get(this.currentSlotId)!;
  }
}
