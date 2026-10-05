import { InvalidConfigError } from "./errors.js";

export class VirtualClock {
  #time = 0;

  now(): number {
    return this.#time;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new InvalidConfigError("advance requires a non-negative number of milliseconds");
    }
    this.#time += ms;
  }
}
