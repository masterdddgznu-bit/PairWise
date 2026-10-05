export class SlotFillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SlotFillError {}
export class CapacityError extends SlotFillError {}
export class UnknownSlotError extends SlotFillError {}
export class UnknownItemError extends SlotFillError {}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (!(ms >= 0)) {
      throw new SlotFillError(`cannot advance clock by ${ms}ms`);
    }
    this.t += ms;
  }
}

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
  items: number[];
}

interface ItemRecord {
  slotId: number;
  payload: unknown;
  taken: boolean;
}

export class SlotFill {
  private readonly clock: VirtualClock;
  private readonly slotMs: number;
  private readonly maxPerSlot: number;
  private readonly maxSealed: number;

  private readonly slots = new Map<number, Slot>();
  private readonly items = new Map<number, ItemRecord>();
  private currentId = 1;
  private nextItemId = 1;

  constructor(options: SlotFillOptions) {
    const { clock, slotMs, maxPerSlot } = options;
    const maxSealed = options.maxSealed ?? 8;
    if (!Number.isInteger(slotMs) || slotMs < 1) {
      throw new InvalidConfigError(`slotMs must be an integer >= 1, got ${slotMs}`);
    }
    if (!Number.isInteger(maxPerSlot) || maxPerSlot < 1) {
      throw new InvalidConfigError(`maxPerSlot must be an integer >= 1, got ${maxPerSlot}`);
    }
    if (!Number.isInteger(maxSealed) || maxSealed < 1) {
      throw new InvalidConfigError(`maxSealed must be an integer >= 1, got ${maxSealed}`);
    }
    this.clock = clock;
    this.slotMs = slotMs;
    this.maxPerSlot = maxPerSlot;
    this.maxSealed = maxSealed;
    this.slots.set(1, { id: 1, start: 0, end: slotMs, status: "open", items: [] });
  }

  submit(payload: unknown): { slotId: number; itemId: number } {
    const slot = this.current();
    if (slot.items.length >= this.maxPerSlot) {
      throw new CapacityError(`slot ${slot.id} is full (${this.maxPerSlot} items)`);
    }
    const itemId = this.nextItemId++;
    slot.items.push(itemId);
    this.items.set(itemId, { slotId: slot.id, payload, taken: false });
    return { slotId: slot.id, itemId };
  }

  seal(): { slotId: number } {
    const sealedId = this.sealCurrent(true)!;
    return { slotId: sealedId };
  }

  drive(): { sealed: number | null } {
    const slot = this.current();
    if (this.clock.now() < slot.end) {
      return { sealed: null };
    }
    return { sealed: this.sealCurrent(false) };
  }

  take(): { slotId: number; itemId: number; payload: unknown } | null {
    let oldest: Slot | null = null;
    for (const slot of this.slots.values()) {
      if (slot.status === "sealed" && (oldest === null || slot.id < oldest.id)) {
        oldest = slot;
      }
    }
    if (oldest === null) {
      return null;
    }
    const itemId = oldest.items.shift()!;
    const record = this.items.get(itemId)!;
    record.taken = true;
    if (oldest.items.length === 0) {
      oldest.status = "drained";
    }
    return { slotId: oldest.id, itemId, payload: record.payload };
  }

  cancel(itemId: number): boolean {
    const record = this.items.get(itemId);
    if (record === undefined) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    const slot = this.current();
    if (record.slotId !== slot.id || slot.status !== "open" || record.taken) {
      return false;
    }
    const index = slot.items.indexOf(itemId);
    if (index === -1) {
      return false;
    }
    slot.items.splice(index, 1);
    return true;
  }

  currentSlot(): number {
    return this.currentId;
  }

  statusOfSlot(slotId: number): SlotStatus {
    const slot = this.slots.get(slotId);
    if (slot === undefined) {
      throw new UnknownSlotError(`unknown slot ${slotId}`);
    }
    return slot.status;
  }

  openIds(): number[] {
    return [...this.current().items];
  }

  readyCount(): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.status === "sealed") {
        count += slot.items.length;
      }
    }
    return count;
  }

  slotOf(itemId: number): number {
    const record = this.items.get(itemId);
    if (record === undefined) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    return record.slotId;
  }

  private current(): Slot {
    return this.slots.get(this.currentId)!;
  }

  private sealedCount(): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.status === "sealed") {
        count += 1;
      }
    }
    return count;
  }

  private sealCurrent(throwOnCapacity: boolean): number | null {
    const slot = this.current();
    const becomesSealed = slot.items.length > 0;
    if (becomesSealed && this.sealedCount() + 1 > this.maxSealed) {
      if (throwOnCapacity) {
        throw new CapacityError(`sealed slot limit ${this.maxSealed} reached`);
      }
      return null;
    }
    slot.status = becomesSealed ? "sealed" : "drained";
    const nextId = slot.id + 1;
    this.slots.set(nextId, {
      id: nextId,
      start: slot.end,
      end: slot.end + this.slotMs,
      status: "open",
      items: [],
    });
    this.currentId = nextId;
    return slot.id;
  }
}
