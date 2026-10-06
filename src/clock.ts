import { InvalidArgumentError } from "./errors.js";

export class VirtualClock {
  private current: number;

  constructor(start = 0) {
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
      throw new InvalidArgumentError("clock start must be a non-negative finite number");
    }
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new InvalidArgumentError("clock advance must be a non-negative finite number");
    }
    this.current += ms;
    return this.current;
  }
}
