/** Virtual logical clock for commit timestamps. */
export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  tick(): number {
    this.t += 1;
    return this.t;
  }

  advanceTo(ts: number): void {
    if (ts > this.t) this.t = ts;
  }
}
