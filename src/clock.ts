export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError("advance requires a finite ms >= 0");
    }
    this.#now += ms;
    return this.#now;
  }
}
