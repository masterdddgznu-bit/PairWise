import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownItemError,
} from "./errors.js";

export type Lane = "primary" | "overflow";
export type ItemStatus = "primary" | "overflow" | "taken";

export interface SpillQOptions {
  clock: VirtualClock;
  maxPrimary: number;
  maxOverflow: number;
  holdMs: number;
  promoteBatch?: number;
}

interface Entry {
  itemId: number;
  payload: unknown;
  spilledAt: number | null;
}

function isValidInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class SpillQ {
  private readonly clock: VirtualClock;
  private readonly maxPrimary: number;
  private readonly maxOverflow: number;
  private readonly holdMs: number;
  private readonly promoteBatch: number;

  private primary: Entry[] = [];
  private overflow: Entry[] = [];
  private readonly statuses = new Map<number, ItemStatus>();
  private nextItemId = 1;

  constructor(options: SpillQOptions) {
    const { clock, maxPrimary, maxOverflow, holdMs } = options;
    const promoteBatch = options.promoteBatch ?? 1;
    if (
      !clock ||
      typeof clock.now !== "function" ||
      !isValidInt(maxPrimary) ||
      !isValidInt(maxOverflow) ||
      !isValidInt(holdMs) ||
      !isValidInt(promoteBatch)
    ) {
      throw new InvalidConfigError(
        "maxPrimary, maxOverflow, holdMs and promoteBatch must be integers >= 1, and a clock is required",
      );
    }
    this.clock = clock;
    this.maxPrimary = maxPrimary;
    this.maxOverflow = maxOverflow;
    this.holdMs = holdMs;
    this.promoteBatch = promoteBatch;
  }

  enqueue(payload: unknown): { itemId: number; lane: Lane } {
    if (this.primary.length < this.maxPrimary) {
      const itemId = this.nextItemId++;
      this.primary.push({ itemId, payload, spilledAt: null });
      this.statuses.set(itemId, "primary");
      return { itemId, lane: "primary" };
    }
    if (this.overflow.length < this.maxOverflow) {
      const itemId = this.nextItemId++;
      this.overflow.push({ itemId, payload, spilledAt: this.clock.now() });
      this.statuses.set(itemId, "overflow");
      return { itemId, lane: "overflow" };
    }
    throw new CapacityError("both primary and overflow queues are full");
  }

  drive(): { promoted: number[] } {
    const promoted: number[] = [];
    const free = this.maxPrimary - this.primary.length;
    if (free <= 0) {
      return { promoted };
    }
    const now = this.clock.now();
    const due = this.overflow
      .filter((entry) => now >= (entry.spilledAt as number) + this.holdMs)
      .sort((a, b) => {
        const byTime = (a.spilledAt as number) - (b.spilledAt as number);
        return byTime !== 0 ? byTime : a.itemId - b.itemId;
      });
    const limit = Math.min(this.promoteBatch, free, due.length);
    for (let i = 0; i < limit; i++) {
      const entry = due[i];
      this.overflow.splice(this.overflow.indexOf(entry), 1);
      entry.spilledAt = null;
      this.primary.push(entry);
      this.statuses.set(entry.itemId, "primary");
      promoted.push(entry.itemId);
    }
    return { promoted };
  }

  take(): { itemId: number; payload: unknown } | null {
    const entry = this.primary.shift();
    if (!entry) {
      return null;
    }
    this.statuses.set(entry.itemId, "taken");
    return { itemId: entry.itemId, payload: entry.payload };
  }

  cancel(itemId: number): boolean {
    const status = this.statuses.get(itemId);
    if (status === undefined) {
      throw new UnknownItemError(`unknown itemId: ${itemId}`);
    }
    if (status === "taken") {
      return false;
    }
    const queue = status === "primary" ? this.primary : this.overflow;
    const index = queue.findIndex((entry) => entry.itemId === itemId);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    this.statuses.delete(itemId);
    return true;
  }

  primaryIds(): number[] {
    return this.primary.map((entry) => entry.itemId);
  }

  overflowIds(): number[] {
    return this.overflow.map((entry) => entry.itemId);
  }

  statusOf(itemId: number): ItemStatus {
    const status = this.statuses.get(itemId);
    if (status === undefined) {
      throw new UnknownItemError(`unknown itemId: ${itemId}`);
    }
    return status;
  }

  primaryCount(): number {
    return this.primary.length;
  }

  overflowCount(): number {
    return this.overflow.length;
  }
}
