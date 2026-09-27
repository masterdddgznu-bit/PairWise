import { VirtualClock } from "./clock.js";
import { EventLog } from "./events.js";
import { SingleFlight } from "./flight.js";
import { LruLayer } from "./lru.js";
import { StoreAdapter } from "./store.js";
import { TtlIndex } from "./ttl.js";
import type { BackendStore, CacheEvent, SetOpts } from "./types.js";

export type CacheTierOptions = { l1Capacity?: number };

export class CacheTier {
  readonly clock: VirtualClock;
  /** @internal */ readonly l1: LruLayer;
  /** @internal */ l2: LruLayer | null = null;
  /** @internal */ readonly ttl: TtlIndex;
  /** @internal */ readonly l2Ttl: TtlIndex;
  /** @internal */ readonly store: StoreAdapter;
  /** @internal */ readonly flight: SingleFlight;
  /** @internal */ readonly events: EventLog;

  constructor(clock?: VirtualClock, opts?: CacheTierOptions) {
    this.clock = clock ?? new VirtualClock();
    this.l1 = new LruLayer(opts?.l1Capacity ?? 2);
    this.ttl = new TtlIndex();
    this.l2Ttl = new TtlIndex();
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
    const expireAt =
      opts?.ttlMs === undefined ? null : this.clock.now() + opts.ttlMs;
    this.putInL1(key, { value, expireAt });
    this.store.set(key, value);
    this.events.append("set", key, this.clock.now());
  }

  private putInL1(key: string, entry: { value: string; expireAt: number | null }): void {
    const staleL2 = this.l2?.peek(key);
    if (staleL2 !== undefined && this.l2 !== null) {
      this.l2.delete(key);
      this.l2Ttl.clear(key);
    }
    const evicted = this.l1.set(key, entry);
    this.ttl.set(key, entry.expireAt);
    if (evicted) this.demoteFromL1(evicted[0], evicted[1]);
  }

  private demoteFromL1(key: string, entry: { value: string; expireAt: number | null }): void {
    this.ttl.clear(key);
    if (this.l2) {
      const l2Evicted = this.l2.set(key, entry);
      this.l2Ttl.set(key, entry.expireAt);
      if (l2Evicted) this.l2Ttl.clear(l2Evicted[0]);
    }
    this.events.append("evict", key, this.clock.now());
  }

  private isExpired(expireAt: number | null): boolean {
    return expireAt !== null && expireAt <= this.clock.now();
  }

  get(key: string): string | null {
    const l1 = this.l1.get(key);
    if (l1) {
      if (this.isExpired(l1.expireAt)) {
        this.l1.delete(key);
        this.ttl.clear(key);
      } else {
        return l1.value;
      }
    }

    const l2 = this.l2?.get(key);
    if (this.l2 && l2) {
      if (this.isExpired(l2.expireAt)) {
        this.l2.delete(key);
        this.l2Ttl.clear(key);
      } else {
        this.l2Ttl.set(key, l2.expireAt);
        this.putInL1(key, l2);
        return l2.value;
      }
    }

    if (!this.store.attached()) return null;
    const fromStore = this.store.get(key);
    if (fromStore === null) return null;
    this.putInL1(key, { value: fromStore, expireAt: null });
    return fromStore;
  }

  delete(key: string): boolean {
    const fromL1 = this.l1.delete(key);
    if (fromL1) this.ttl.clear(key);
    const fromL2 = this.l2?.delete(key) ?? false;
    if (fromL2) this.l2Ttl.clear(key);
    this.store.delete(key);
    if (fromL1 || fromL2) {
      this.events.append("delete", key, this.clock.now());
    }
    return fromL1 || fromL2;
  }

  size(): number {
    return this.l1.size();
  }

  keys(): string[] {
    return this.l1.keys();
  }

  tick(): void {
    const now = this.clock.now();
    for (const key of this.ttl.expired(now)) {
      if (this.l1.peek(key)) {
        this.l1.delete(key);
        this.events.append("expire", key, now);
      }
    }
    if (this.l2) {
      for (const key of this.l2Ttl.expired(now)) {
        if (this.l2.peek(key)) {
          this.l2.delete(key);
          this.events.append("expire", key, now);
        }
      }
    }
  }

  getOrLoad(key: string, loader: () => string): string {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const loaded = this.flight.getOrLoad(key, () => {
      const nested = this.get(key);
      if (nested !== null) return nested;
      return loader();
    });
    if (this.get(key) === null) {
      this.set(key, loaded);
    }
    return loaded;
  }

  batchGet(keys: string[]): Array<string | null> {
    return keys.map((key) => this.get(key));
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
