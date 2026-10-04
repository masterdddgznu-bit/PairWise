export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error("VirtualClock.advance: ms must be >= 0");
    }
    this.current += ms;
  }
}
