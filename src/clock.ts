import { InvalidArgError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new InvalidArgError(`advance requires ms >= 0, got ${ms}`);
    }
    this.current += ms;
  }
}
