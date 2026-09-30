import type { VirtualClock } from "./clock.js";
import { LocalCache } from "./cache.js";
import { GenError, StaleGenError } from "./errors.js";
import { InvQueue } from "./invqueue.js";
import type { HubStats } from "./types.js";

type Shard = {
  cache: LocalCache;
  appliedGen: number;
};

/** Sharded cache hub with global generation fencing and invalidation queue. */
export class GenHub {
  private readonly shards = new Map<string, Shard>();
  private readonly queue: InvQueue;
  private globalGen = 0;
  private stalePutRejections = 0;

  constructor(private readonly clock: VirtualClock, shardIds: string[]) {
    for (const id of shardIds) {
      if (this.shards.has(id)) {
        throw new GenError(`Duplicate shard id: ${id}`);
      }
      this.shards.set(id, { cache: new LocalCache(), appliedGen: 0 });
    }
    this.queue = new InvQueue(clock);
  }

  private requireShard(shardId: string): Shard {
    const shard = this.shards.get(shardId);
    if (!shard) {
      throw new GenError(`Unknown shard: ${shardId}`);
    }
    return shard;
  }

  /** Apply all queued invalidations this shard has not caught up with. */
  private applyPending(shard: Shard): number {
    let applied = 0;
    let lastGen = shard.appliedGen;
    for (const record of this.queue.all()) {
      if (record.gen > shard.appliedGen) {
        shard.cache.delete(record.key);
        lastGen = record.gen;
        applied++;
      }
    }
    shard.appliedGen = lastGen;
    return applied;
  }

  put(shardId: string, key: string, value: string, gen: number): void {
    const shard = this.requireShard(shardId);
    if (gen !== this.globalGen || shard.appliedGen !== this.globalGen) {
      this.stalePutRejections++;
      throw new StaleGenError(
        `Stale put: gen=${gen}, globalGen=${this.globalGen}, appliedGen=${shard.appliedGen}`,
      );
    }
    shard.cache.put(key, value);
  }

  get(shardId: string, key: string): string | undefined {
    const shard = this.requireShard(shardId);
    this.applyPending(shard);
    return shard.cache.get(key);
  }

  invalidate(key: string, mode: "eager" | "lazy"): number {
    const gen = ++this.globalGen;
    this.queue.push({ gen, key, mode, at: this.clock.now() });
    if (mode === "eager") {
      for (const shard of this.shards.values()) {
        this.applyPending(shard);
        shard.cache.delete(key);
        shard.appliedGen = gen;
      }
    }
    return gen;
  }

  catchUp(shardId: string): number {
    const shard = this.requireShard(shardId);
    return this.applyPending(shard);
  }

  pendingCount(shardId: string): number {
    const shard = this.requireShard(shardId);
    let count = 0;
    for (const record of this.queue.all()) {
      if (record.gen > shard.appliedGen) {
        count++;
      }
    }
    return count;
  }

  generation(): number {
    return this.globalGen;
  }

  shardGen(shardId: string): number {
    return this.requireShard(shardId).appliedGen;
  }

  reap(ttlMs: number): number {
    return this.queue.reap(ttlMs, (record) => {
      for (const shard of this.shards.values()) {
        if (shard.appliedGen < record.gen) {
          return false;
        }
      }
      return true;
    });
  }

  stats(): HubStats {
    return {
      globalGen: this.globalGen,
      pendingInvs: this.queue.count(),
      stalePutRejections: this.stalePutRejections,
    };
  }
}
