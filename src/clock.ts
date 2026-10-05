import { DebtLaneError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new DebtLaneError(`cannot advance clock by ${ms}`);
    }
    this.current += ms;
  }
}
