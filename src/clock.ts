import { InvalidArgError } from "./errors.js";

export class VirtualClock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new InvalidArgError("advance(ms) requires a non-negative number");
    }
    this.current += ms;
  }
}
