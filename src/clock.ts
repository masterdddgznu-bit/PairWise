import { InvalidArgError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new InvalidArgError(`advance requires a finite ms >= 0, got ${String(ms)}`);
    }
    this.current += ms;
    return this.current;
  }
}
