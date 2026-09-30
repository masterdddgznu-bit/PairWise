import type { VirtualClock } from "./clock.js";
import type { InvalidationRecord } from "./types.js";

/** Invalidation queue — starter stub. */
export class InvQueue {
  constructor(_clock: VirtualClock) {}

  push(_record: InvalidationRecord): void {
    throw new Error("InvQueue push not implemented");
  }

  all(): InvalidationRecord[] {
    throw new Error("InvQueue all not implemented");
  }

  reap(_ttlMs: number, _allApplied: (gen: number) => boolean): number {
    throw new Error("InvQueue reap not implemented");
  }

  count(): number {
    throw new Error("InvQueue count not implemented");
  }
}
