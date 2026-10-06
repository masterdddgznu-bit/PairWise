export class ManualClock {
  private current: number;

  constructor(initial = 0) {
    this.current = initial;
  }

  now(): number {
    return this.current;
  }

  advance(delta: number): number {
    this.current += delta;
    return this.current;
  }
}
