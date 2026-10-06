export class ManualClock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(delta: number): number {
    this.current += delta;
    return this.current;
  }
}
