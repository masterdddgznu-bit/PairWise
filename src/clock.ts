import { HlcGateError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new HlcGateError(`advance requires a non-negative number, got ${ms}`);
    }
    this.current += ms;
    return this.current;
  }
}
