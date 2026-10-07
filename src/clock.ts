export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new Error("advance requires a finite, non-negative number of ms");
    }
    this.current += ms;
  }
}
