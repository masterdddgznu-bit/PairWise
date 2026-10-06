import { InvalidArgError } from "./errors.js";

export class VirtualClock {
  private t: number;

  constructor(start = 0) {
    if (typeof start !== "number" || !Number.isFinite(start)) {
      throw new InvalidArgError("VirtualClock start must be a finite number");
    }
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new InvalidArgError("advance(ms) requires a finite ms >= 0");
    }
    this.t += ms;
    return this.t;
  }
}
