import { SapBoilError } from "./errors.js";

export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new SapBoilError("advance requires a finite ms >= 0");
    }
    this.#now += ms;
  }
}
