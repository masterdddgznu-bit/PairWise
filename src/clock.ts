export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`advance requires a finite ms >= 0, got ${ms}`);
    }
    this.current += ms;
  }
}
