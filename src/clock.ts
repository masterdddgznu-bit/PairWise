export class VirtualClock {
  private time = 0;

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new RangeError("cannot advance clock by a negative amount");
    }
    this.time += ms;
  }
}
