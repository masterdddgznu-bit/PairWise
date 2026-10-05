import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
} from "./errors.js";

export interface KeyFlushOptions {
  clock: VirtualClock;
  idleMs: number;
  maxPending?: number;
  maxReady?: number;
}

export type ObserveResult = { status: "accepted" | "updated" };
export type DriveResult = { flushed: string[] };
export type TakeResult = { key: string; payload: unknown } | null;

interface PendingEntry {
  payload: unknown;
  lastAt: number;
}

interface ReadyEntry {
  key: string;
  payload: unknown;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1`);
  }
}

function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError("key must be a non-empty string");
  }
}

export class KeyFlush {
  private readonly clock: VirtualClock;
  private readonly idleMs: number;
  private readonly maxPending: number;
  private readonly maxReady: number;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly ready: ReadyEntry[] = [];

  constructor(options: KeyFlushOptions) {
    if (options === null || typeof options !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    if (!(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    assertPositiveInteger(options.idleMs, "idleMs");
    const maxPending = options.maxPending ?? 16;
    const maxReady = options.maxReady ?? 16;
    assertPositiveInteger(maxPending, "maxPending");
    assertPositiveInteger(maxReady, "maxReady");
    this.clock = options.clock;
    this.idleMs = options.idleMs;
    this.maxPending = maxPending;
    this.maxReady = maxReady;
  }

  observe(key: string, payload: unknown): ObserveResult {
    assertValidKey(key);
    const now = this.clock.now();
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.lastAt = now;
      return { status: "updated" };
    }
    if (this.pending.size >= this.maxPending) {
      throw new CapacityError(
        `pending capacity ${this.maxPending} reached`,
      );
    }
    this.pending.set(key, { payload, lastAt: now });
    return { status: "accepted" };
  }

  flush(key: string): boolean {
    assertValidKey(key);
    const entry = this.pending.get(key);
    if (entry === undefined) {
      return false;
    }
    if (this.ready.length >= this.maxReady) {
      throw new CapacityError(`ready capacity ${this.maxReady} reached`);
    }
    this.pending.delete(key);
    this.ready.push({ key, payload: entry.payload });
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const due = [...this.pending.entries()]
      .filter(([, entry]) => now >= entry.lastAt + this.idleMs)
      .sort(
        (a, b) => a[1].lastAt - b[1].lastAt || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      )
      .map(([key]) => key);
    const flushed: string[] = [];
    for (const key of due) {
      if (this.ready.length >= this.maxReady) {
        break;
      }
      const entry = this.pending.get(key);
      if (entry === undefined) {
        continue;
      }
      this.pending.delete(key);
      this.ready.push({ key, payload: entry.payload });
      flushed.push(key);
    }
    return { flushed };
  }

  take(): TakeResult {
    const entry = this.ready.shift();
    if (entry === undefined) {
      return null;
    }
    return { key: entry.key, payload: entry.payload };
  }

  cancel(key: string): boolean {
    assertValidKey(key);
    if (this.pending.delete(key)) {
      return true;
    }
    const index = this.ready.findIndex((entry) => entry.key === key);
    if (index >= 0) {
      this.ready.splice(index, 1);
      return true;
    }
    return false;
  }

  pendingKeys(): string[] {
    return [...this.pending.entries()]
      .sort(
        (a, b) => a[1].lastAt - b[1].lastAt || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      )
      .map(([key]) => key);
  }

  readyKeys(): string[] {
    return this.ready.map((entry) => entry.key);
  }

  pendingCount(): number {
    return this.pending.size;
  }

  readyCount(): number {
    return this.ready.length;
  }

  peekPending(key: string): unknown {
    assertValidKey(key);
    return this.pending.get(key)?.payload;
  }
}
