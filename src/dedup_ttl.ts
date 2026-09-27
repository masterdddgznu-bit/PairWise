import { VirtualClock } from "./clock.js";
import { EntryStore } from "./entry_store.js";
import { InvalidConfigError, InvalidKeyError } from "./errors.js";
import { pickVictim } from "./evict.js";
import { dueEntries } from "./expiry_index.js";
import type { Entry, RememberResult } from "./types.js";

export type DedupTtlOptions = {
  clock: VirtualClock;
  ttl?: number;
  capacity?: number;
};

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidConfigError(`${name} must be a positive integer`);
  }
}

/** TTL dedup window. */
export class DedupTtl {
  readonly clock: VirtualClock;
  private readonly ttl: number;
  private readonly capacity: number;
  private readonly store = new EntryStore();
  private nextSeq = 0;

  constructor(opts: DedupTtlOptions) {
    this.clock = opts.clock;
    this.ttl = opts.ttl ?? 10;
    this.capacity = opts.capacity ?? 8;
    assertPositiveInt("ttl", this.ttl);
    assertPositiveInt("capacity", this.capacity);
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
    const now = this.clock.now();
    const due = this.store
      .values()
      .filter((e) => e.expireAt <= now)
      .sort((a, b) => a.expireAt - b.expireAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const entry of due) {
      this.store.delete(entry.key);
    }
    return due.map((e) => e.key);
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
    for (const entry of dueEntries(this.store.values(), this.clock.now())) {
      this.store.delete(entry.key);
    }
  }
}

function assertKey(key: string): void {
  if (key === "") {
    throw new InvalidKeyError();
  }
}
