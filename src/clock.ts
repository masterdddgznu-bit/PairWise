import { FrisketError } from "./errors.js";

export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new FrisketError("advance requires a finite ms >= 0");
    }
    this.#now += ms;
    return this.#now;
  }
}
