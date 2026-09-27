import { VirtualClock } from "./clock.js";
import { EntryStore } from "./entry_store.js";
import { dueEntries } from "./expiry_index.js";
import { pickVictim } from "./evict.js";
import { InvalidConfigError, InvalidKeyError } from "./errors.js";
import type { Entry, RememberResult } from "./types.js";

export type DedupTtlOptions = {
  clock: VirtualClock;
  ttl?: number;
  capacity?: number;
};

/** TTL dedup window. */
export class DedupTtl {
  readonly clock: VirtualClock;
  private readonly ttl: number;
  private readonly capacity: number;
  private readonly store = new EntryStore();
  private nextSeq = 0;

  constructor(opts: DedupTtlOptions) {
    const ttl = opts.ttl ?? 10;
    const capacity = opts.capacity ?? 8;
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new InvalidConfigError("ttl must be a positive integer");
    }
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new InvalidConfigError("capacity must be a positive integer");
    }
    this.clock = opts.clock;
    this.ttl = ttl;
    this.capacity = capacity;
  }

  remember(key: string): RememberResult {
    assertKey(key);
    this.lazyExpire();
    const now = this.clock.now();
    const existing = this.store.get(key);
    if (existing !== undefined) {
      existing.expireAt = now + this.ttl;
      return { inserted: false, refreshed: true, evicted: null };
    }
    let evicted: string | null = null;
    if (this.store.size() >= this.capacity) {
      const victim = pickVictim(this.store.values());
      if (victim !== null) {
        this.store.delete(victim.key);
        evicted = victim.key;
      }
    }
    const entry: Entry = { key, expireAt: now + this.ttl, seq: this.nextSeq };
    this.nextSeq += 1;
    this.store.set(entry);
    return { inserted: true, refreshed: false, evicted };
  }

  seen(key: string): boolean {
    assertKey(key);
    this.lazyExpire();
    return this.store.get(key) !== undefined;
  }

  forget(key: string): boolean {
    assertKey(key);
    return this.store.delete(key);
  }

  expireNow(): string[] {
    const due = dueEntries(this.store.values(), this.clock.now());
    for (const entry of due) {
      this.store.delete(entry.key);
    }
    return due
      .sort((a, b) => a.expireAt - b.expireAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((e) => e.key);
  }

  tick(): string[] {
    this.clock.advance(1);
    return this.expireNow();
  }

  size(): number {
    this.lazyExpire();
    return this.store.size();
  }

  keys(): string[] {
    this.lazyExpire();
    return this.store
      .values()
      .sort((a, b) => a.seq - b.seq)
      .map((e) => e.key);
  }

  private lazyExpire(): void {
    this.expireNow();
  }
}

function assertKey(key: string): void {
  if (key === "") {
    throw new InvalidKeyError();
  }
}
