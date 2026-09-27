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

  configureL2(_capacity: number): void {
    throw new Error("configureL2 not implemented");
  }

  attachStore(backend: BackendStore): void {
    this.store.attach(backend);
  }

  set(key: string, value: string, _opts?: SetOpts): void {
    const evicted = this.l1.set(key, { value, expireAt: null });
    if (evicted) {
      // starter: drop evicted; feature should demote to L2 + emit evict
    }
    this.events.append("set", key, this.clock.now());
  }

  get(key: string): string | null {
    const e = this.l1.get(key);
    return e ? e.value : null;
  }

  delete(key: string): boolean {
    const ok = this.l1.delete(key);
    if (ok) this.events.append("delete", key, this.clock.now());
    return ok;
  }

  size(): number {
    return this.l1.size();
  }

  keys(): string[] {
    return this.l1.keys();
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  getOrLoad(key: string, loader: () => string): string {
    return this.flight.getOrLoad(key, loader);
  }

  batchGet(_keys: string[]): Array<string | null> {
    throw new Error("batchGet not implemented");
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
