import { FrisketError } from "./errors.js";

export class VirtualClock {
  #current = 0;

  now(): number {
    return this.#current;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new FrisketError("advance(ms) requires a finite number >= 0");
    }
    this.#current += ms;
    return this.#current;
  }
}
