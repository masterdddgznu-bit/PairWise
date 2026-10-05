import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateRecentError,
  InvalidConfigError,
  InvalidIdError,
  PoisonedError,
} from "./errors.js";

export interface DedupeQOptions {
  clock: VirtualClock;
  windowMs: number;
  poisonMs?: number;
  maxQueue?: number;
}

export type EnqueueResult = { status: "accepted" } | { status: "updated" };

export interface QueueEntry {
  id: string;
  payload: unknown;
}

export interface DriveResult {
  forgotten: string[];
  detoxed: string[];
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function compareEntries(a: [string, number], b: [string, number]): number {
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

export class DedupeQ {
  private readonly clock: VirtualClock;
  private readonly windowMs: number;
  private readonly poisonMs: number;
  private readonly maxQueue: number;

  private readonly queue = new Map<string, unknown>();
  private readonly completed = new Map<string, number>();
  private readonly poisoned = new Map<string, number>();

  constructor(options: DedupeQOptions) {
    const { clock, windowMs, poisonMs, maxQueue } = options;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    if (!isPositiveInteger(windowMs)) {
      throw new InvalidConfigError("windowMs must be an integer >= 1");
    }
    const effectivePoisonMs = poisonMs ?? windowMs;
    if (!isPositiveInteger(effectivePoisonMs)) {
      throw new InvalidConfigError("poisonMs must be an integer >= 1");
    }
    const effectiveMaxQueue = maxQueue ?? 16;
    if (!isPositiveInteger(effectiveMaxQueue)) {
      throw new InvalidConfigError("maxQueue must be an integer >= 1");
    }
    this.clock = clock;
    this.windowMs = windowMs;
    this.poisonMs = effectivePoisonMs;
    this.maxQueue = effectiveMaxQueue;
  }

  private requireId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private sweepExpired(): void {
    const now = this.clock.now();
    for (const [id, at] of this.completed) {
      if (now - at >= this.windowMs) this.completed.delete(id);
    }
    for (const [id, at] of this.poisoned) {
      if (now - at >= this.poisonMs) this.poisoned.delete(id);
    }
  }

  enqueue(id: string, payload: unknown): EnqueueResult {
    this.requireId(id);
    this.sweepExpired();
    if (this.queue.has(id)) {
      this.queue.set(id, payload);
      return { status: "updated" };
    }
    if (this.poisoned.has(id)) {
      throw new PoisonedError(`id "${id}" is poisoned`);
    }
    if (this.completed.has(id)) {
      throw new DuplicateRecentError(`id "${id}" completed recently`);
    }
    if (this.queue.size >= this.maxQueue) {
      throw new CapacityError("queue is at capacity");
    }
    this.queue.set(id, payload);
    return { status: "accepted" };
  }

  pop(): QueueEntry | null {
    const first = this.queue.entries().next();
    if (first.done) return null;
    const [id, payload] = first.value;
    this.queue.delete(id);
    this.completed.set(id, this.clock.now());
    return { id, payload };
  }

  cancel(id: string): boolean {
    this.requireId(id);
    if (!this.queue.delete(id)) return false;
    this.completed.set(id, this.clock.now());
    return true;
  }

  poison(id: string): void {
    this.requireId(id);
    this.poisoned.set(id, this.clock.now());
  }

  clearPoison(id: string): boolean {
    this.requireId(id);
    return this.poisoned.delete(id);
  }

  isPoisoned(id: string): boolean {
    this.requireId(id);
    const at = this.poisoned.get(id);
    if (at === undefined) return false;
    return this.clock.now() - at < this.poisonMs;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const forgotten: [string, number][] = [];
    for (const [id, at] of this.completed) {
      if (now - at >= this.windowMs) forgotten.push([id, at]);
    }
    forgotten.sort(compareEntries);
    for (const [id] of forgotten) this.completed.delete(id);

    const detoxed: [string, number][] = [];
    for (const [id, at] of this.poisoned) {
      if (now - at >= this.poisonMs) detoxed.push([id, at]);
    }
    detoxed.sort(compareEntries);
    for (const [id] of detoxed) this.poisoned.delete(id);

    return {
      forgotten: forgotten.map(([id]) => id),
      detoxed: detoxed.map(([id]) => id),
    };
  }

  ids(): string[] {
    return [...this.queue.keys()];
  }

  size(): number {
    return this.queue.size;
  }

  peek(): QueueEntry | null {
    const first = this.queue.entries().next();
    if (first.done) return null;
    const [id, payload] = first.value;
    return { id, payload };
  }

  recentIds(): string[] {
    const now = this.clock.now();
    const valid: [string, number][] = [];
    for (const [id, at] of this.completed) {
      if (now - at < this.windowMs) valid.push([id, at]);
    }
    valid.sort(compareEntries);
    return valid.map(([id]) => id);
  }

  poisonedIds(): string[] {
    const now = this.clock.now();
    const valid: [string, number][] = [];
    for (const [id, at] of this.poisoned) {
      if (now - at < this.poisonMs) valid.push([id, at]);
    }
    valid.sort(compareEntries);
    return valid.map(([id]) => id);
  }

  completedAtOf(id: string): number | null {
    this.requireId(id);
    return this.completed.get(id) ?? null;
  }

  poisonedAtOf(id: string): number | null {
    this.requireId(id);
    return this.poisoned.get(id) ?? null;
  }
}
