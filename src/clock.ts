import { InvalidConfigError, StateError } from "./errors.js";

export class VirtualClock {
  private time: number;

  constructor(start = 0) {
    if (!Number.isFinite(start) || start < 0) {
      throw new InvalidConfigError("clock start must be a non-negative finite number");
    }
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  advance(delta: number): number {
    if (!Number.isFinite(delta) || delta < 0) {
      throw new StateError("virtual clock can only advance forward");
    }
    this.time += delta;
    return this.time;
  }
}
