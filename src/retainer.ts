import { ClaimBudget } from "./budget.js";
import type { VirtualClock } from "./clock.js";
import {
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

export type HoldResult = { status: "accepted" | "updated" };

export type DriveResult = { expired: string[] };

interface Entry {
  payload: unknown;
  deadline: number;
  pinned: boolean;
}

export class Retainer {
  readonly #clock: VirtualClock;
  readonly #ttlMs: number;
  readonly #maxKeys: number;
  readonly #budget: ClaimBudget;
  readonly #entries = new Map<string, Entry>();

  constructor(options: RetainerOptions) {
    const { clock, ttlMs, maxKeys = 16, initialCredits = 0 } = options ?? ({} as RetainerOptions);
    if (clock === null || clock === undefined || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new InvalidConfigError("ttlMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new InvalidConfigError("maxKeys must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredits) || initialCredits < 0) {
      throw new InvalidConfigError("initialCredits must be an integer >= 0");
    }
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#maxKeys = maxKeys;
    this.#budget = new ClaimBudget(initialCredits);
  }

  hold(key: string, payload: unknown): HoldResult {
    this.#requireKey(key);
    this.#lazyExpire(key);
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.deadline = this.#clock.now() + this.#ttlMs;
      return { status: "updated" };
    }
    if (this.#entries.size >= this.#maxKeys) {
      throw new CapacityError(`retainer is full (${this.#maxKeys} keys)`);
    }
    this.#entries.set(key, {
      payload,
      deadline: this.#clock.now() + this.#ttlMs,
      pinned: false,
    });
    return { status: "accepted" };
  }

  get(key: string): unknown {
    this.#requireKey(key);
    this.#lazyExpire(key);
    return this.#entries.get(key)?.payload;
  }

  claim(key: string): { payload: unknown } | null {
    this.#requireKey(key);
    this.#lazyExpire(key);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.pinned) {
      throw new PinError(`key "${key}" is pinned`);
    }
    this.#budget.spend();
    this.#entries.delete(key);
    return { payload: entry.payload };
  }

  pin(key: string): boolean {
    this.#requireKey(key);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      throw new PinError(`cannot pin unregistered key "${key}"`);
    }
    entry.pinned = true;
    return true;
  }

  unpin(key: string): boolean {
    this.#requireKey(key);
    const entry = this.#entries.get(key);
    if (entry === undefined || !entry.pinned) {
      return false;
    }
    entry.pinned = false;
    if (this.#isExpired(entry)) {
      this.#entries.delete(key);
    }
    return true;
  }

  cancel(key: string): boolean {
    this.#requireKey(key);
    return this.#entries.delete(key);
  }

  drive(): DriveResult {
    const expired: string[] = [];
    for (const [key, entry] of this.#entries) {
      if (!entry.pinned && this.#isExpired(entry)) {
        expired.push(key);
      }
    }
    for (const key of expired) {
      this.#entries.delete(key);
    }
    return { expired };
  }

  grant(n: number): void {
    this.#budget.grant(n);
  }

  credits(): number {
    return this.#budget.credits();
  }

  keys(): string[] {
    return [...this.#entries.keys()];
  }

  size(): number {
    return this.#entries.size;
  }

  deadlineOf(key: string): number | undefined {
    this.#requireKey(key);
    return this.#entries.get(key)?.deadline;
  }

  isPinned(key: string): boolean {
    this.#requireKey(key);
    return this.#entries.get(key)?.pinned ?? false;
  }

  #isExpired(entry: Entry): boolean {
    return this.#clock.now() >= entry.deadline;
  }

  #lazyExpire(key: string): void {
    const entry = this.#entries.get(key);
    if (entry !== undefined && !entry.pinned && this.#isExpired(entry)) {
      this.#entries.delete(key);
    }
  }

  #requireKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidKeyError("key must be a non-empty string");
    }
  }
}
