import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
} from "./errors.js";
import { Entry, TouchOrder } from "./touch-order.js";

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
  private readonly clock: VirtualClock;
  private readonly ttlMs: number;
  private readonly maxItems: number;
  private readonly store = new TouchOrder<V>();

  constructor(options: AgeEvictOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      !(options.clock instanceof VirtualClock)
    ) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    if (!Number.isInteger(options.ttlMs) || options.ttlMs < 1) {
      throw new InvalidConfigError("ttlMs must be an integer >= 1");
    }
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    this.clock = options.clock;
    this.ttlMs = options.ttlMs;
    this.maxItems = maxItems;
  }

  set(key: string, value: V): SetResult {
    this.assertKey(key);
    const now = this.clock.now();
    const existing = this.store.get(key);
    if (existing !== undefined) {
      existing.value = value;
      existing.deadline = now + this.ttlMs;
      this.store.touch(key, existing, now);
      return { status: "updated" };
    }

    let evicted: string[] | undefined;
    if (this.store.size >= this.maxItems) {
      evicted = this.makeRoom(now);
    }
    const entry: Entry<V> = {
      value,
      deadline: now + this.ttlMs,
      touchedAt: now,
      pinned: false,
    };
    this.store.insert(key, entry);
    return evicted !== undefined && evicted.length > 0
      ? { status: "accepted", evicted }
      : { status: "accepted" };
  }

  get(key: string): V | undefined {
    this.assertKey(key);
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    const now = this.clock.now();
    if (now >= entry.deadline) {
      this.store.delete(key);
      return undefined;
    }
    this.store.touch(key, entry, now);
    return entry.value;
  }

  delete(key: string): boolean {
    this.assertKey(key);
    return this.store.delete(key);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expired = this.store.expiredKeys(now);
    for (const key of expired) {
      this.store.delete(key);
    }
    return { expired };
  }

  pin(key: string): boolean {
    this.assertKey(key);
    const entry = this.store.get(key);
    if (entry === undefined) {
      return false;
    }
    entry.pinned = true;
    return true;
  }

  unpin(key: string): boolean {
    this.assertKey(key);
    const entry = this.store.get(key);
    if (entry === undefined) {
      return false;
    }
    entry.pinned = false;
    return true;
  }

  isPinned(key: string): boolean {
    this.assertKey(key);
    return this.store.get(key)?.pinned ?? false;
  }

  keys(): string[] {
    return this.store.keys();
  }

  size(): number {
    return this.store.size;
  }

  deadlineOf(key: string): number | undefined {
    this.assertKey(key);
    return this.store.get(key)?.deadline;
  }

  touchedAtOf(key: string): number | undefined {
    this.assertKey(key);
    return this.store.get(key)?.touchedAt;
  }

  /**
   * Frees one slot for a new key: purges every expired entry first (touch
   * order, oldest to newest), then evicts the oldest unpinned survivor.
   * Throws CapacityError when only pinned live entries remain.
   */
  private makeRoom(now: number): string[] {
    const evicted = this.store.expiredKeys(now);
    for (const key of evicted) {
      this.store.delete(key);
    }
    if (this.store.size < this.maxItems) {
      return evicted;
    }
    const victim = this.store.oldestUnpinnedKey();
    if (victim === undefined) {
      throw new CapacityError(
        "capacity reached and no unpinned entry can be evicted",
      );
    }
    this.store.delete(victim);
    evicted.push(victim);
    return evicted;
  }

  private assertKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidKeyError("key must be a non-empty string");
    }
  }
}
