export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new RangeError("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}
