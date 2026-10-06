import { InvalidConfigError } from "./errors.js";

export class VirtualClock {
  private current: number;

  constructor(start = 0) {
    if (!Number.isFinite(start) || start < 0) {
      throw new InvalidConfigError("clock start must be a non-negative finite number");
    }
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(delta: number): number {
    if (!Number.isFinite(delta) || delta < 0) {
      throw new InvalidConfigError("clock advance must be a non-negative finite number");
    }
    this.current += delta;
    return this.current;
  }
}
