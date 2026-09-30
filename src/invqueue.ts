import type { VirtualClock } from "./clock.js";
import type { InvalidationRecord } from "./types.js";

/** Append-only invalidation queue with virtual-clock TTL reaping. */
export class InvQueue {
  private readonly records: InvalidationRecord[] = [];

  constructor(private readonly clock: VirtualClock) {}

  push(record: InvalidationRecord): void {
    this.records.push(record);
  }

  all(): readonly InvalidationRecord[] {
    return this.records;
  }

  /**
   * Drop records that are older than `ttlMs` and have been applied by
   * every shard. Returns the number dropped.
   */
  reap(ttlMs: number, allApplied: (record: InvalidationRecord) => boolean): number {
    const now = this.clock.now();
    let dropped = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i];
      if (now - record.at >= ttlMs && allApplied(record)) {
        this.records.splice(i, 1);
        dropped++;
      }
    }
    return dropped;
  }

  count(): number {
    return this.records.length;
  }
}
