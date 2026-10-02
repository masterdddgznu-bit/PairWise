/** Virtual logical clock for commit timestamps. */
export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  /** BUG: does not advance internal counter. */
  tick(): number {
    return this.t;
  }
}
