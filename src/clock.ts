export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new Error(`VirtualClock.advance: invalid delta ${ms}`);
    }
    this.current += ms;
  }
}
