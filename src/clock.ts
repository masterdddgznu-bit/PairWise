import { AgeEvictError } from "./errors.js";

export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !(ms >= 0)) {
      throw new AgeEvictError(`advance requires a non-negative number, got ${ms}`);
    }
    this.#now += ms;
  }
}
