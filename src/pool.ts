import { VirtualClock } from "./clock.js";
import { EventLog } from "./events.js";
import { ResourcePools } from "./resources.js";
import { TokenCounter } from "./tokens.js";
import { TtlIndex } from "./ttl.js";
import type { AcquireOpts, Lease, LeaseEvent } from "./types.js";

/**
 * Resource lease pool.
 * Base createPool/acquire/release/holders work.
 * Feature methods wired to unfinished modules.
 */
export class LeasePool {
  readonly clock: VirtualClock;
  /** @internal */ readonly pools: ResourcePools;
  /** @internal */ readonly tokens: TokenCounter;
  /** @internal */ readonly ttl: TtlIndex;
  /** @internal */ readonly events: EventLog;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.pools = new ResourcePools();
    this.tokens = new TokenCounter();
    this.ttl = new TtlIndex();
    this.events = new EventLog();
  }

  createPool(name: string, capacity: number): void {
    this.pools.create(name, capacity);
  }

  acquire(pool: string, holderId: string, opts?: AcquireOpts): Lease | null {
    const free = this.pools.findFree(pool);
    if (!free) return null;
    const token = this.tokens.next();
    free.holderId = holderId;
    free.token = token;
    free.expireAt =
      opts?.ttlMs !== undefined ? this.clock.now() + opts.ttlMs : null;
    if (free.expireAt !== null) {
      // Feature incomplete on starter — ttl.set throws; only call when ttl used.
      try {
        this.ttl.set(pool, free.resourceId, free.expireAt);
      } catch {
        // starter: ignore ttl index
      }
    }
    const now = this.clock.now();
    this.events.append("acquire", pool, free.resourceId, holderId, now);
    return {
      pool,
      resourceId: free.resourceId,
      holderId,
      token,
      expireAt: free.expireAt,
    };
  }

  release(
    pool: string,
    resourceId: string,
    holderId: string,
    token?: number,
  ): boolean {
    const r = this.pools.find(pool, resourceId);
    if (!r || r.holderId !== holderId) return false;
    if (token !== undefined && r.token !== token) return false;
    r.holderId = null;
    r.token = 0;
    r.expireAt = null;
    this.ttl.clear(pool, resourceId);
    this.events.append("release", pool, resourceId, holderId, this.clock.now());
    return true;
  }

  holders(pool: string): string[] {
    const list = this.pools.get(pool);
    if (!list) return [];
    const ids = new Set<string>();
    for (const r of list) {
      if (r.holderId) ids.add(r.holderId);
    }
    return [...ids].sort();
  }

  renew(
    pool: string,
    resourceId: string,
    holderId: string,
    ttlMs: number,
  ): boolean {
    void pool;
    void resourceId;
    void holderId;
    void ttlMs;
    throw new Error("renew not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  steal(
    pool: string,
    resourceId: string,
    newHolderId: string,
    opts?: AcquireOpts,
  ): Lease | null {
    void pool;
    void resourceId;
    void newHolderId;
    void opts;
    throw new Error("steal not implemented");
  }

  batchAcquire(
    pool: string,
    holderId: string,
    n: number,
    opts?: AcquireOpts,
  ): Lease[] {
    void pool;
    void holderId;
    void n;
    void opts;
    throw new Error("batchAcquire not implemented");
  }

  currentSeq(): number {
    return this.events.currentSeq();
  }

  watch(fromSeq: number): string {
    return this.events.watch(fromSeq);
  }

  pollWatch(watchId: string): LeaseEvent[] {
    return this.events.pollWatch(watchId);
  }

  unwatch(watchId: string): void {
    this.events.unwatch(watchId);
  }

  compact(beforeSeq: number): void {
    this.events.compact(beforeSeq);
  }
}
