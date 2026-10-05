import { VirtualClock } from "./clock.js";
import {
  BudgetError,
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
  PinError,
} from "./errors.js";

export interface RetainerOptions {
  clock: VirtualClock;
  ttlMs: number;
  maxKeys?: number;
  initialCredits?: number;
}

export type HoldStatus = "accepted" | "updated";

export interface HoldResult {
  status: HoldStatus;
}

export interface ClaimResult<T> {
  payload: T;
}

export interface DriveResult {
  expired: string[];
}

interface Entry<T> {
  payload: T;
  deadline: number;
  pinned: boolean;
}

export class Retainer<T = unknown> {
  private readonly clock: VirtualClock;
  private readonly ttlMs: number;
  private readonly maxKeys: number;
  private budget: number;
  private readonly entries = new Map<string, Entry<T>>();

  constructor(options: RetainerOptions) {
    const { clock, ttlMs, maxKeys = 16, initialCredits = 0 } = options;
    if (!clock) {
      throw new InvalidConfigError("clock is required");
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new InvalidConfigError(`ttlMs must be an integer >= 1, got ${ttlMs}`);
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new InvalidConfigError(`maxKeys must be an integer >= 1, got ${maxKeys}`);
    }
    if (!Number.isInteger(initialCredits) || initialCredits < 0) {
      throw new InvalidConfigError(
        `initialCredits must be an integer >= 0, got ${initialCredits}`,
      );
    }
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxKeys = maxKeys;
    this.budget = initialCredits;
  }

  hold(key: string, payload: T): HoldResult {
    this.assertValidKey(key);
    this.lazyExpire(key);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.deadline = this.clock.now() + this.ttlMs;
      return { status: "updated" };
    }
    if (this.entries.size >= this.maxKeys) {
      throw new CapacityError(
        `capacity ${this.maxKeys} reached; cannot hold "${key}"`,
      );
    }
    this.entries.set(key, {
      payload,
      deadline: this.clock.now() + this.ttlMs,
      pinned: false,
    });
    return { status: "accepted" };
  }

  claim(key: string): ClaimResult<T> | null {
    this.assertValidKey(key);
    this.lazyExpire(key);
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.pinned) {
      throw new PinError(`cannot claim pinned key "${key}"`);
    }
    if (this.budget < 1) {
      throw new BudgetError("no claim credits available");
    }
    if (entry === undefined) {
      return null;
    }
    this.budget -= 1;
    this.entries.delete(key);
    return { payload: entry.payload };
  }

  get(key: string): T | undefined {
    this.assertValidKey(key);
    this.lazyExpire(key);
    return this.entries.get(key)?.payload;
  }

  pin(key: string): boolean {
    this.assertValidKey(key);
    const entry = this.entries.get(key);
    if (entry === undefined) {
      throw new PinError(`cannot pin unregistered key "${key}"`);
    }
    entry.pinned = true;
    return true;
  }

  unpin(key: string): boolean {
    this.assertValidKey(key);
    const entry = this.entries.get(key);
    if (entry === undefined || !entry.pinned) {
      return false;
    }
    entry.pinned = false;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
    }
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expired: string[] = [];
    for (const [key, entry] of this.entries) {
      if (!entry.pinned && now >= entry.deadline) {
        expired.push(key);
      }
    }
    for (const key of expired) {
      this.entries.delete(key);
    }
    return { expired };
  }

  cancel(key: string): boolean {
    this.assertValidKey(key);
    return this.entries.delete(key);
  }

  grant(n: number): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new BudgetError(`grant requires an integer >= 0, got ${n}`);
    }
    this.budget += n;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  size(): number {
    return this.entries.size;
  }

  deadlineOf(key: string): number | undefined {
    this.assertValidKey(key);
    return this.entries.get(key)?.deadline;
  }

  isPinned(key: string): boolean {
    this.assertValidKey(key);
    return this.entries.get(key)?.pinned ?? false;
  }

  credits(): number {
    return this.budget;
  }

  private lazyExpire(key: string): void {
    const entry = this.entries.get(key);
    if (entry !== undefined && !entry.pinned && this.isExpired(entry)) {
      this.entries.delete(key);
    }
  }

  private isExpired(entry: Entry<T>): boolean {
    return this.clock.now() >= entry.deadline;
  }

  private assertValidKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidKeyError(`key must be a non-empty string, got ${String(key)}`);
    }
  }
}
