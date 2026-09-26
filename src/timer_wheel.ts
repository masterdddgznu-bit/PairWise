import { VirtualClock } from "./clock.js";
import type { FiredTimer } from "./types.js";
export type TimerWheelOptions = {
  clock: VirtualClock;
  slotCount?: number;
  levels?: number;
  tickMs?: number;
};
/** Hierarchical timing wheel — stub. */
export class TimerWheel {
  readonly clock: VirtualClock;
  constructor(opts: TimerWheelOptions) { this.clock = opts.clock; }
  schedule(_id: string, _delayMs: number, _payload: string): void { /* stub */ }
  cancel(_id: string): boolean { return false; }
  advance(_toTime: number): FiredTimer[] { return []; }
  tick(): FiredTimer[] { return []; }
  pendingCount(): number { return 0; }
  maxDelay(): number { return 0; }
}
