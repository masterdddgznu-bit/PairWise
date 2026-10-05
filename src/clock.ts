export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new RangeError("cannot advance the clock by a negative amount");
    }
    this.current += ms;
  }
}
