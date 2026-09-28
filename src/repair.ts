import type { RepairRequest } from "./types.js";
import type { VirtualClock } from "./clock.js";

export class RepairTimer {
  private readonly n: number;
  private readonly clock: VirtualClock;
  private readonly timeoutMs: number;
  private readonly since: (number | null)[];

  constructor(
    n: number,
    clock: VirtualClock,
    timeoutMs: number,
  ) {
    this.n = n;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.since = Array.from({ length: n }, () => null);
  }

  noteBufferNonEmpty(to: number): void {
    if (this.since[to] === null) {
      this.since[to] = this.clock.now();
    }
  }

  noteBufferEmpty(to: number): void {
    this.since[to] = null;
  }

  tick(missingOf: (to: number) => { from: number; seq: number }[]): RepairRequest[] {
    const out: RepairRequest[] = [];
    const now = this.clock.now();
    for (let to = 0; to < this.n; to++) {
      const start = this.since[to];
      if (start === null) continue;
      if (now - start < this.timeoutMs) continue;
      const missing = missingOf(to);
      this.since[to] = now;
      if (missing.length > 0) {
        out.push({ to, missing });
      }
    }
    return out;
  }

  drain(): RepairRequest[] {
    return [];
  }
}
