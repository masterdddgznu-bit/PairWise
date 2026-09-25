/** Logical clock for visibility timeouts — stub is functional. */
export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    this.t += ms;
  }
}
