export class VirtualClock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    if (ms < 0) throw new Error("negative");
    this.t += ms;
  }
}
