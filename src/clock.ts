/** Logical clock for sliding-window timestamps — not wall time. */
export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    this.t += ms;
  }
}
