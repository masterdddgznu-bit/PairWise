import { VirtualClock } from "./clock.js";
import { EventLog } from "./events.js";
import { SingleFlight } from "./flight.js";
import { LruLayer } from "./lru.js";
import { StoreAdapter } from "./store.js";
import { TtlIndex } from "./ttl.js";
import type { BackendStore, CacheEvent, Entry, SetOpts } from "./types.js";

export type CacheTierOptions = { l1Capacity?: number };

export class CacheTier {
  readonly clock: VirtualClock;
  /** @internal */ readonly l1: LruLayer;
  /** @internal */ l2: LruLayer | null = null;
  /** @internal */ readonly ttl: TtlIndex;
  /** @internal */ readonly store: StoreAdapter;
  /** @internal */ readonly flight: SingleFlight;
  /** @internal */ readonly events: EventLog;

  constructor(clock?: VirtualClock, opts?: CacheTierOptions) {
    this.clock = clock ?? new VirtualClock();
    this.l1 = new LruLayer(opts?.l1Capacity ?? 2);
    this.ttl = new TtlIndex();
    this.store = new StoreAdapter();
    this.flight = new SingleFlight();
    this.events = new EventLog();
  }

  configureL2(capacity: number): void {
    this.l2 = new LruLayer(capacity);
  }

  attachStore(backend: BackendStore): void {
    this.store.attach(backend);
  }

  set(key: string, value: string, opts?: SetOpts): void {
    const expireAt = opts?.ttlMs == null ? null : this.clock.now() + opts.ttlMs;
    this.ttl.set(key, expireAt);
    // Exclusive hierarchy: a fresh write shadows any L2 copy.
    this.l2?.delete(key);
    const evicted = this.l1.set(key, { value, expireAt });
    if (evicted) this.demote(evicted[0], evicted[1]);
    this.store.set(key, value);
    this.events.append("set", key, this.clock.now());
  }

  get(key: string): string | null {
    const at = this.clock.now();

    const l1Entry = this.l1.peek(key);
    if (l1Entry) {
      if (l1Entry.expireAt !== null && l1Entry.expireAt <= at) {
        this.l1.delete(key);
        this.l2?.delete(key);
        this.ttl.clear(key);
        this.events.append("expire", key, at);
      } else {
        // LruLayer.get refreshes recency.
        return this.l1.get(key)!.value;
      }
    }

    const l2Entry = this.l2?.peek(key);
    if (l2Entry) {
      if (l2Entry.expireAt !== null && l2Entry.expireAt <= at) {
        this.l2!.delete(key);
        this.ttl.clear(key);
        this.events.append("expire", key, at);
      } else {
        // Refresh L2 recency, then promote exclusively back into L1.
        this.l2!.get(key);
        this.l2!.delete(key);
        this.fillL1(key, l2Entry);
        return l2Entry.value;
      }
    }

    const stored = this.store.get(key);
    if (stored === null) return null;
    // Backfilled entries carry no local TTL.
    this.fillL1(key, { value: stored, expireAt: null });
    return stored;
  }

  delete(key: string): boolean {
    const existed = this.l1.delete(key) || (this.l2?.delete(key) ?? false);
    this.ttl.clear(key);
    this.store.delete(key);
    if (existed) this.events.append("delete", key, this.clock.now());
    return existed;
  }

  size(): number {
    return this.l1.size();
  }

  keys(): string[] {
    return this.l1.keys();
  }

  tick(): void {
    const at = this.clock.now();
    for (const key of this.ttl.expired(at)) {
      const inL1 = this.l1.peek(key) !== undefined;
      const inL2 = this.l2?.peek(key) !== undefined;
      if (inL1) this.l1.delete(key);
      if (inL2) this.l2!.delete(key);
      if (inL1 || inL2) {
        this.ttl.clear(key);
        this.events.append("expire", key, at);
      }
    }
  }

  getOrLoad(key: string, loader: () => string): string {
    const cached = this.get(key);
    if (cached !== null) return cached;
    return this.flight.run(key, () => {
      const value = loader();
      this.set(key, value);
      return value;
    });
  }

  batchGet(keys: string[]): Array<string | null> {
    return keys.map((key) => this.get(key));
  }

  /** Writes an entry into L1, demoting whatever L1 evicts. */
  private fillL1(key: string, entry: Entry): void {
    const evicted = this.l1.set(key, entry);
    if (evicted) this.demote(evicted[0], evicted[1]);
  }

  /** Demotes an L1-evicted entry into L2 (with its TTL), recording `evict`. */
  private demote(key: string, entry: Entry): void {
    this.events.append("evict", key, this.clock.now());
    if (!this.l2) {
      this.ttl.clear(key);
      return;
    }
    const displaced = this.l2.set(key, entry);
    if (displaced) this.ttl.clear(displaced[0]);
  }

  currentSeq(): number {
    return this.events.currentSeq();
  }

  watch(fromSeq: number): string {
    return this.events.watch(fromSeq);
  }

  pollWatch(watchId: string): CacheEvent[] {
    return this.events.pollWatch(watchId);
  }

  unwatch(watchId: string): void {
    this.events.unwatch(watchId);
  }

  compact(beforeSeq: number): void {
    this.events.compact(beforeSeq);
  }
}
