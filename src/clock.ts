import { InvalidArgError } from "./errors.js";

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new InvalidArgError("advance requires a non-negative number of ms");
    }
    this.t += ms;
  }
}
