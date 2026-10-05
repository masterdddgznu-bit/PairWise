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

export interface ObserveResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  flushed: string[];
}

export interface TakenEntry {
  key: string;
  payload: unknown;
}

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
    throw new InvalidConfigError(
      `${name} must be an integer >= 1, got ${value}`,
    );
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
    const { clock, idleMs, maxPending = 16, maxReady = 16 } = options;
    if (!(clock instanceof VirtualClock)) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    assertPositiveInteger(idleMs, "idleMs");
    assertPositiveInteger(maxPending, "maxPending");
    assertPositiveInteger(maxReady, "maxReady");
    this.clock = clock;
    this.idleMs = idleMs;
    this.maxPending = maxPending;
    this.maxReady = maxReady;
  }

  observe(key: string, payload: unknown): ObserveResult {
    assertValidKey(key);
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.lastAt = this.clock.now();
      return { status: "updated" };
    }
    if (this.pending.size >= this.maxPending) {
      throw new CapacityError(
        `pending capacity ${this.maxPending} reached; cannot add key ${JSON.stringify(key)}`,
      );
    }
    this.pending.set(key, { payload, lastAt: this.clock.now() });
    return { status: "accepted" };
  }

  flush(key: string): boolean {
    assertValidKey(key);
    const entry = this.pending.get(key);
    if (entry === undefined) {
      return false;
    }
    if (this.ready.length >= this.maxReady) {
      throw new CapacityError(
        `ready capacity ${this.maxReady} reached; cannot flush key ${JSON.stringify(key)}`,
      );
    }
    this.pending.delete(key);
    this.ready.push({ key, payload: entry.payload });
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const due: string[] = [];
    for (const [key, entry] of this.pending) {
      if (now >= entry.lastAt + this.idleMs) {
        due.push(key);
      }
    }
    due.sort((a, b) => {
      const ea = this.pending.get(a)!;
      const eb = this.pending.get(b)!;
      if (ea.lastAt !== eb.lastAt) return ea.lastAt - eb.lastAt;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const flushed: string[] = [];
    for (const key of due) {
      if (this.ready.length >= this.maxReady) break;
      const entry = this.pending.get(key)!;
      this.pending.delete(key);
      this.ready.push({ key, payload: entry.payload });
      flushed.push(key);
    }
    return { flushed };
  }

  take(): TakenEntry | null {
    const head = this.ready.shift();
    if (head === undefined) return null;
    return { key: head.key, payload: head.payload };
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
      .sort((a, b) => {
        if (a[1].lastAt !== b[1].lastAt) return a[1].lastAt - b[1].lastAt;
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      })
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
