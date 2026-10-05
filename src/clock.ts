import { DedupeQError } from "./errors.js";

export class VirtualClock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new DedupeQError("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}
