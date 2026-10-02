/** Virtual logical clock for startTs / commitTs. */
export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  tick(): number {
    this.t += 1;
    return this.t;
  }
}
