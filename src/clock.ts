export class VirtualClock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error(`cannot advance clock by negative amount: ${ms}`);
    }
    this.current += ms;
  }
}
