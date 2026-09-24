import type { LogicalTime } from "./types.js";

/** Shared logical clock for the whole process (all shards + coordinator). */
export class LogicalClock {
  private t: LogicalTime = 0;
  now(): LogicalTime {
    return this.t;
  }
  tick(): LogicalTime {
    this.t += 1;
    return this.t;
  }
}
