export class SpillQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SpillQError {}
export class InvalidEnqueueError extends SpillQError {}
export class CapacityError extends SpillQError {}
export class UnknownItemError extends SpillQError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new SpillQError(`advance requires a non-negative finite ms, got ${ms}`);
    }
    this.current += ms;
  }
}

export type Lane = "primary" | "overflow";
export type ItemStatus = Lane | "taken";

export interface SpillQOptions {
  clock: VirtualClock;
  maxPrimary: number;
  maxOverflow: number;
  holdMs: number;
  promoteBatch?: number;
}

interface Item {
  itemId: number;
  payload: unknown;
  spilledAt: number;
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export class SpillQ {
  private readonly clock: VirtualClock;
  private readonly maxPrimary: number;
  private readonly maxOverflow: number;
  private readonly holdMs: number;
  private readonly promoteBatch: number;

  private nextItemId = 1;
  private primary: Item[] = [];
  private overflow: Item[] = [];
  private taken = new Set<number>();

  constructor(options: SpillQOptions) {
    const { clock, maxPrimary, maxOverflow, holdMs } = options;
    const promoteBatch = options.promoteBatch ?? 1;
    if (
      !(clock instanceof VirtualClock) ||
      !isPositiveInt(maxPrimary) ||
      !isPositiveInt(maxOverflow) ||
      !isPositiveInt(holdMs) ||
      !isPositiveInt(promoteBatch)
    ) {
      throw new InvalidConfigError(
        "maxPrimary, maxOverflow, holdMs and promoteBatch must be integers >= 1, and clock must be a VirtualClock",
      );
    }
    this.clock = clock;
    this.maxPrimary = maxPrimary;
    this.maxOverflow = maxOverflow;
    this.holdMs = holdMs;
    this.promoteBatch = promoteBatch;
  }

  enqueue(payload: unknown): { itemId: number; lane: Lane } {
    if (arguments.length === 0) {
      throw new InvalidEnqueueError("enqueue requires a payload");
    }
    const itemId = this.nextItemId;
    if (this.primary.length < this.maxPrimary) {
      this.nextItemId += 1;
      this.primary.push({ itemId, payload, spilledAt: 0 });
      return { itemId, lane: "primary" };
    }
    if (this.overflow.length < this.maxOverflow) {
      this.nextItemId += 1;
      this.overflow.push({ itemId, payload, spilledAt: this.clock.now() });
      return { itemId, lane: "overflow" };
    }
    throw new CapacityError("both primary and overflow are full");
  }

  drive(): { promoted: number[] } {
    const room = this.maxPrimary - this.primary.length;
    if (room <= 0) {
      return { promoted: [] };
    }
    const now = this.clock.now();
    const due = this.overflow
      .filter((item) => now >= item.spilledAt + this.holdMs)
      .sort((a, b) => a.spilledAt - b.spilledAt || a.itemId - b.itemId);
    const count = Math.min(due.length, this.promoteBatch, room);
    const promoted: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const item = due[i];
      this.overflow.splice(this.overflow.indexOf(item), 1);
      this.primary.push(item);
      promoted.push(item.itemId);
    }
    return { promoted };
  }

  take(): { itemId: number; payload: unknown } | null {
    const item = this.primary.shift();
    if (item === undefined) {
      return null;
    }
    this.taken.add(item.itemId);
    return { itemId: item.itemId, payload: item.payload };
  }

  cancel(itemId: number): boolean {
    const primaryIndex = this.primary.findIndex((item) => item.itemId === itemId);
    if (primaryIndex >= 0) {
      this.primary.splice(primaryIndex, 1);
      return true;
    }
    const overflowIndex = this.overflow.findIndex((item) => item.itemId === itemId);
    if (overflowIndex >= 0) {
      this.overflow.splice(overflowIndex, 1);
      return true;
    }
    if (this.taken.has(itemId)) {
      return false;
    }
    throw new UnknownItemError(`unknown itemId ${itemId}`);
  }

  primaryIds(): number[] {
    return this.primary.map((item) => item.itemId);
  }

  overflowIds(): number[] {
    return this.overflow.map((item) => item.itemId);
  }

  statusOf(itemId: number): ItemStatus {
    if (this.primary.some((item) => item.itemId === itemId)) {
      return "primary";
    }
    if (this.overflow.some((item) => item.itemId === itemId)) {
      return "overflow";
    }
    if (this.taken.has(itemId)) {
      return "taken";
    }
    throw new UnknownItemError(`unknown itemId ${itemId}`);
  }

  primaryCount(): number {
    return this.primary.length;
  }

  overflowCount(): number {
    return this.overflow.length;
  }
}
