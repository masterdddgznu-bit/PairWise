import { PeatCutError } from "./errors.js";

export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new PeatCutError("advance requires a finite number >= 0");
    }
    this.#now += ms;
    return this.#now;
  }
}
