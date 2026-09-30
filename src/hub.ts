import type { VirtualClock } from "./clock.js";
import type { HubStats } from "./types.js";

/** Generation-numbered cache hub — starter stub. */
export class GenHub {
  constructor(_clock: VirtualClock, _shardIds: string[]) {}

  put(_shardId: string, _key: string, _value: string, _gen: number): void {
    throw new Error("put not implemented");
  }

  get(_shardId: string, _key: string): string | undefined {
    throw new Error("get not implemented");
  }

  invalidate(_key: string, _mode: "eager" | "lazy"): number {
    throw new Error("invalidate not implemented");
  }

  catchUp(_shardId: string): number {
    throw new Error("catchUp not implemented");
  }

  pendingCount(_shardId: string): number {
    throw new Error("pendingCount not implemented");
  }

  generation(): number {
    throw new Error("generation not implemented");
  }

  shardGen(_shardId: string): number {
    throw new Error("shardGen not implemented");
  }

  reap(_ttlMs: number): number {
    throw new Error("reap not implemented");
  }

  stats(): HubStats {
    throw new Error("stats not implemented");
  }
}
