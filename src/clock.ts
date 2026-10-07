export class VirtualClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`cannot advance clock by ${ms}`);
    }
    this.#now += ms;
    return this.#now;
  }
}
