export class ManualClock {
  private current: number;

  constructor(start = 0) {
    if (!Number.isFinite(start)) {
      throw new Error("clock start must be a finite number");
    }
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(delta: number): void {
    if (!Number.isFinite(delta) || delta < 0) {
      throw new Error("clock advance must be a non-negative finite number");
    }
    this.current += delta;
  }
}
