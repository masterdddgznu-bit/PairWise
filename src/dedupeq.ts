import type { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateRecentError,
  InvalidConfigError,
  InvalidIdError,
  PoisonedError,
} from "./errors.js";
import { TimestampedSet } from "./expiry-set.js";
import { FifoQueue, type QueueEntry } from "./queue.js";

export interface DedupeQConfig {
  clock: VirtualClock;
  windowMs: number;
  poisonMs?: number;
  maxQueue?: number;
}

export type EnqueueResult = { status: "accepted" } | { status: "updated" };

export interface DriveResult {
  forgotten: string[];
  detoxed: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class DedupeQ {
  private readonly clock: VirtualClock;
  private readonly windowMs: number;
  private readonly poisonMs: number;
  private readonly maxQueue: number;
  private readonly queue = new FifoQueue();
  private readonly completed = new TimestampedSet();
  private readonly poisoned = new TimestampedSet();

  constructor(config: DedupeQConfig) {
    const { clock, windowMs } = config;
    const poisonMs = config.poisonMs ?? windowMs;
    const maxQueue = config.maxQueue ?? 16;
    if (
      clock === null ||
      typeof clock !== "object" ||
      typeof clock.now !== "function"
    ) {
      throw new InvalidConfigError("clock with now() is required");
    }
    if (!isPositiveInt(windowMs)) {
      throw new InvalidConfigError("windowMs must be an integer >= 1");
    }
    if (!isPositiveInt(poisonMs)) {
      throw new InvalidConfigError("poisonMs must be an integer >= 1");
    }
    if (!isPositiveInt(maxQueue)) {
      throw new InvalidConfigError("maxQueue must be an integer >= 1");
    }
    this.clock = clock;
    this.windowMs = windowMs;
    this.poisonMs = poisonMs;
    this.maxQueue = maxQueue;
  }

  enqueue(id: string, payload: unknown): EnqueueResult {
    assertValidId(id);
    this.sweepExpired();
    if (this.queue.has(id)) {
      this.queue.set(id, payload);
      return { status: "updated" };
    }
    if (this.poisoned.isLive(id, this.clock.now(), this.poisonMs)) {
      throw new PoisonedError(`id "${id}" is poisoned`);
    }
    if (this.completed.isLive(id, this.clock.now(), this.windowMs)) {
      throw new DuplicateRecentError(`id "${id}" completed recently`);
    }
    if (this.queue.size() >= this.maxQueue) {
      throw new CapacityError(`queue is full (maxQueue=${this.maxQueue})`);
    }
    this.queue.set(id, payload);
    return { status: "accepted" };
  }

  pop(): QueueEntry | null {
    const entry = this.queue.shift();
    if (entry === null) {
      return null;
    }
    this.completed.set(entry.id, this.clock.now());
    return entry;
  }

  cancel(id: string): boolean {
    assertValidId(id);
    if (!this.queue.delete(id)) {
      return false;
    }
    this.completed.set(id, this.clock.now());
    return true;
  }

  poison(id: string): void {
    assertValidId(id);
    this.poisoned.set(id, this.clock.now());
  }

  clearPoison(id: string): boolean {
    assertValidId(id);
    return this.poisoned.delete(id);
  }

  isPoisoned(id: string): boolean {
    assertValidId(id);
    return this.poisoned.isLive(id, this.clock.now(), this.poisonMs);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    return {
      forgotten: this.completed.sweepExpired(now, this.windowMs),
      detoxed: this.poisoned.sweepExpired(now, this.poisonMs),
    };
  }

  ids(): string[] {
    return this.queue.ids();
  }

  size(): number {
    return this.queue.size();
  }

  peek(): QueueEntry | null {
    return this.queue.peek();
  }

  recentIds(): string[] {
    return this.completed.liveIds(this.clock.now(), this.windowMs);
  }

  poisonedIds(): string[] {
    return this.poisoned.liveIds(this.clock.now(), this.poisonMs);
  }

  completedAtOf(id: string): number | null {
    return this.completed.rawAt(id);
  }

  poisonedAtOf(id: string): number | null {
    return this.poisoned.rawAt(id);
  }

  private sweepExpired(): void {
    const now = this.clock.now();
    this.completed.sweepExpired(now, this.windowMs);
    this.poisoned.sweepExpired(now, this.poisonMs);
  }
}
