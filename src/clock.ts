export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new Error("advance requires a non-negative number of milliseconds");
    }
    this.current += ms;
  }
}
