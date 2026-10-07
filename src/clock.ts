import { LauterBedError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new LauterBedError("advance requires a non-negative finite number");
    }
    this.current += ms;
    return this.current;
  }
}
