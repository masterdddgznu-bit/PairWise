export class VirtualClock {
  private currentMs = 0;

  now(): number {
    return this.currentMs;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new Error("VirtualClock.advance: ms must be a non-negative number");
    }
    this.currentMs += ms;
  }
}
