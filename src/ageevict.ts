import { VirtualClock } from "./clock.js";
import { CapacityError, InvalidConfigError, InvalidKeyError } from "./errors.js";
import { EntryStore } from "./store.js";

export interface AgeEvictOptions {
  clock: VirtualClock;
  ttlMs: number;
  maxItems?: number;
}

export interface SetResult {
  status: "accepted" | "updated";
  evicted?: string[];
}

export interface DriveResult {
  expired: string[];
}

const DEFAULT_MAX_ITEMS = 16;

export class AgeEvict<V = unknown> {
  readonly #clock: VirtualClock;
  readonly #ttlMs: number;
  readonly #maxItems: number;
  readonly #store = new EntryStore<V>();

  constructor(options: AgeEvictOptions) {
    const { clock, ttlMs, maxItems = DEFAULT_MAX_ITEMS } = options ?? ({} as AgeEvictOptions);
    if (clock === null || typeof clock !== "object" || typeof clock.now !== "function") {
      throw new InvalidConfigError("clock with a now() function is required");
    }
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new InvalidConfigError(`ttlMs must be an integer >= 1, got ${ttlMs}`);
    }
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError(`maxItems must be an integer >= 1, got ${maxItems}`);
    }
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#maxItems = maxItems;
  }

  set(key: string, value: V): SetResult {
    this.#assertKey(key);
    const now = this.#clock.now();
    const existing = this.#store.get(key);
    if (existing !== undefined) {
      existing.value = value;
      existing.deadline = now + this.#ttlMs;
      this.#store.touch(key, now);
      return { status: "updated" };
    }

    let evicted: string[] | undefined;
    if (this.#store.size >= this.#maxItems) {
      const purged = this.#purgeExpired(now);
      if (this.#store.size >= this.#maxItems) {
        const victim = this.#store.oldestUnpinned();
        if (victim === undefined) {
          throw new CapacityError(
            `capacity ${this.#maxItems} reached and every registered key is pinned`,
          );
        }
        this.#store.delete(victim);
        purged.push(victim);
      }
      if (purged.length > 0) evicted = purged;
    }

    this.#store.insert(key, {
      value,
      deadline: now + this.#ttlMs,
      touchedAt: now,
      pinned: false,
    });
    return evicted === undefined ? { status: "accepted" } : { status: "accepted", evicted };
  }

  get(key: string): V | undefined {
    this.#assertKey(key);
    const entry = this.#store.get(key);
    if (entry === undefined) return undefined;
    const now = this.#clock.now();
    if (now >= entry.deadline) {
      this.#store.delete(key);
      return undefined;
    }
    this.#store.touch(key, now);
    return entry.value;
  }

  delete(key: string): boolean {
    this.#assertKey(key);
    return this.#store.delete(key);
  }

  drive(): DriveResult {
    return { expired: this.#purgeExpired(this.#clock.now()) };
  }

  pin(key: string): boolean {
    this.#assertKey(key);
    const entry = this.#store.get(key);
    if (entry === undefined) return false;
    entry.pinned = true;
    return true;
  }

  unpin(key: string): boolean {
    this.#assertKey(key);
    const entry = this.#store.get(key);
    if (entry === undefined) return false;
    entry.pinned = false;
    return true;
  }

  isPinned(key: string): boolean {
    this.#assertKey(key);
    return this.#store.get(key)?.pinned ?? false;
  }

  keys(): string[] {
    return this.#store.keysOldestFirst();
  }

  size(): number {
    return this.#store.size;
  }

  deadlineOf(key: string): number | undefined {
    this.#assertKey(key);
    return this.#store.get(key)?.deadline;
  }

  touchedAtOf(key: string): number | undefined {
    this.#assertKey(key);
    return this.#store.get(key)?.touchedAt;
  }

  /** Remove every expired entry (pinned or not); return keys in touch order. */
  #purgeExpired(now: number): string[] {
    const expired: string[] = [];
    for (const key of this.#store.keysOldestFirst()) {
      const entry = this.#store.get(key);
      if (entry !== undefined && now >= entry.deadline) {
        this.#store.delete(key);
        expired.push(key);
      }
    }
    return expired;
  }

  #assertKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidKeyError("key must be a non-empty string");
    }
  }
}
