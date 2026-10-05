import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidEnqueueError,
  UnknownItemError,
} from "./errors.js";

export interface RankQOptions {
  clock: VirtualClock;
  maxSize: number;
  ageMs: number;
  maxPriority: number;
  ageBatch?: number;
}

type Status = "queued" | "taken";

interface Item {
  itemId: number;
  payload: unknown;
  priority: number;
  enqueuedAt: number;
  rankAt: number;
  status: Status;
}

function compareItems(a: Item, b: Item): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
  return a.itemId - b.itemId;
}

export class RankQ {
  private readonly clock: VirtualClock;
  private readonly maxSize: number;
  private readonly ageMs: number;
  private readonly maxPriority: number;
  private readonly ageBatch: number;
  private readonly items = new Map<number, Item>();
  private nextId = 1;

  constructor(options: RankQOptions) {
    const { clock, maxSize, ageMs, maxPriority, ageBatch } = options;
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new InvalidConfigError("maxSize must be an integer >= 1");
    }
    if (!Number.isInteger(ageMs) || ageMs < 1) {
      throw new InvalidConfigError("ageMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxPriority) || maxPriority < 0) {
      throw new InvalidConfigError("maxPriority must be an integer >= 0");
    }
    if (ageBatch !== undefined && (!Number.isInteger(ageBatch) || ageBatch < 1)) {
      throw new InvalidConfigError("ageBatch must be an integer >= 1");
    }
    this.clock = clock;
    this.maxSize = maxSize;
    this.ageMs = ageMs;
    this.maxPriority = maxPriority;
    this.ageBatch = ageBatch === undefined ? Infinity : ageBatch;
  }

  enqueue(payload: unknown, priority: number): { itemId: number } {
    if (
      !Number.isInteger(priority) ||
      !Number.isFinite(priority) ||
      priority < 0 ||
      priority > this.maxPriority
    ) {
      throw new InvalidEnqueueError(
        `priority must be a finite integer in [0, ${this.maxPriority}]`,
      );
    }
    if (this.size() >= this.maxSize) {
      throw new CapacityError("queue is at maxSize");
    }
    const now = this.clock.now();
    const item: Item = {
      itemId: this.nextId++,
      payload,
      priority,
      enqueuedAt: now,
      rankAt: now,
      status: "queued",
    };
    this.items.set(item.itemId, item);
    return { itemId: item.itemId };
  }

  take(): { itemId: number; priority: number; payload: unknown } | null {
    const head = this.queuedSorted()[0];
    if (head === undefined) return null;
    head.status = "taken";
    return { itemId: head.itemId, priority: head.priority, payload: head.payload };
  }

  drive(): { aged: number[] } {
    const now = this.clock.now();
    const due = this.queuedSorted().filter(
      (item) =>
        item.priority < this.maxPriority && now >= item.rankAt + this.ageMs,
    );
    const selected = due.slice(0, this.ageBatch);
    const aged: number[] = [];
    for (const item of selected) {
      item.priority += 1;
      item.rankAt = now;
      aged.push(item.itemId);
    }
    return { aged };
  }

  cancel(itemId: number): boolean {
    const item = this.getItem(itemId);
    if (item.status === "taken") return false;
    this.items.delete(itemId);
    return true;
  }

  peekIds(): number[] {
    return this.queuedSorted().map((item) => item.itemId);
  }

  priorityOf(itemId: number): number {
    return this.getItem(itemId).priority;
  }

  size(): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.status === "queued") count += 1;
    }
    return count;
  }

  statusOf(itemId: number): Status {
    return this.getItem(itemId).status;
  }

  private getItem(itemId: number): Item {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new UnknownItemError(`unknown itemId: ${itemId}`);
    }
    return item;
  }

  private queuedSorted(): Item[] {
    const queued: Item[] = [];
    for (const item of this.items.values()) {
      if (item.status === "queued") queued.push(item);
    }
    queued.sort(compareItems);
    return queued;
  }
}
