/** Logical clock — stub is functional for API consistency. */
export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    this.t += ms;
  }
}
