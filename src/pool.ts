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
      this.ttl.set(pool, free.resourceId, free.expireAt);
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
    const r = this.pools.find(pool, resourceId);
    if (!r || r.holderId === null || r.holderId !== holderId) return false;
    r.expireAt = this.clock.now() + ttlMs;
    this.ttl.set(pool, resourceId, r.expireAt);
    this.events.append("renew", pool, resourceId, holderId, this.clock.now());
    return true;
  }

  tick(): void {
    const now = this.clock.now();
    for (const { pool, resourceId } of this.ttl.expired(now)) {
      const r = this.pools.find(pool, resourceId);
      if (!r || r.holderId === null) continue;
      if (r.expireAt === null || r.expireAt > now) continue;
      const holderId = r.holderId;
      r.holderId = null;
      r.token = 0;
      r.expireAt = null;
      this.events.append("expire", pool, resourceId, holderId, now);
    }
  }

  steal(
    pool: string,
    resourceId: string,
    newHolderId: string,
    opts?: AcquireOpts,
  ): Lease | null {
    const r = this.pools.find(pool, resourceId);
    if (!r || r.holderId === null) return null;
    const token = this.tokens.next();
    r.holderId = newHolderId;
    r.token = token;
    r.expireAt =
      opts?.ttlMs !== undefined ? this.clock.now() + opts.ttlMs : null;
    this.ttl.clear(pool, resourceId);
    if (r.expireAt !== null) {
      this.ttl.set(pool, resourceId, r.expireAt);
    }
    this.events.append(
      "steal",
      pool,
      resourceId,
      newHolderId,
      this.clock.now(),
    );
    return {
      pool,
      resourceId,
      holderId: newHolderId,
      token,
      expireAt: r.expireAt,
    };
  }

  batchAcquire(
    pool: string,
    holderId: string,
    n: number,
    opts?: AcquireOpts,
  ): Lease[] {
    const leases: Lease[] = [];
    for (let i = 0; i < n; i++) {
      const lease = this.acquire(pool, holderId, opts);
      if (!lease) break;
      leases.push(lease);
    }
    return leases;
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
