import { InvalidConfigError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new InvalidConfigError("advance requires a finite ms >= 0");
    }
    this.current += ms;
    return this.current;
  }
}
