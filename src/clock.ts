import { InvalidConfigError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (!Number.isInteger(ms) || ms < 0) {
      throw new InvalidConfigError("advance requires a non-negative integer");
    }
    this.current += ms;
    return this.current;
  }
}
