import type { Clock } from "./types.js";

export class ManualClock implements Clock {
  constructor(private t = 0) {}
  nowMs(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
