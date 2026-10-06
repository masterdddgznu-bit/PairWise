import { InvalidArgError } from "./errors.js";

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new InvalidArgError(`advance requires a finite ms >= 0, got ${String(ms)}`);
    }
    this.t += ms;
  }
}
