export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new RangeError("advance requires a non-negative number of ms");
    }
    this.#now += ms;
  }
}
