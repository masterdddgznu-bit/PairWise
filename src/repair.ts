import type { RepairRequest } from "./types.js";
import type { VirtualClock } from "./clock.js";

export class RepairTimer {
  private readonly n: number;
  private readonly clock: VirtualClock;
  private readonly timeoutMs: number;
  private readonly anchor: (number | null)[];
  private readonly pending: RepairRequest[] = [];

  constructor(n: number, clock: VirtualClock, timeoutMs: number) {
    this.n = n;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.anchor = Array.from({ length: n }, () => null);
  }

  noteBufferNonEmpty(to: number): void {
    this.anchor[to] = this.clock.now();
  }

  noteBufferEmpty(to: number): void {
    this.anchor[to] = null;
  }

  tick(missingOf: (to: number) => { from: number; seq: number }[]): RepairRequest[] {
    const now = this.clock.now();
    const fresh: RepairRequest[] = [];
    for (let to = 0; to < this.n; to++) {
      const since = this.anchor[to];
      if (since === null) continue;
      if (now - since < this.timeoutMs) continue;
      const missing = missingOf(to);
      if (missing.length === 0) continue;
      const req: RepairRequest = { to, missing };
      this.pending.push(req);
      fresh.push(req);
      this.anchor[to] = now;
    }
    return fresh;
  }

  drain(): RepairRequest[] {
    if (this.pending.length === 0) return [];
    return this.pending.splice(0, this.pending.length);
  }
}
