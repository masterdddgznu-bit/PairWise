import { InvalidArgError } from "./errors.js";

export class VirtualClock {
  private current: number;

  constructor(start = 0) {
    if (typeof start !== "number" || !Number.isFinite(start)) {
      throw new InvalidArgError("clock start must be a finite number");
    }
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new InvalidArgError("advance requires a non-negative finite ms");
    }
    this.current += ms;
  }
}
