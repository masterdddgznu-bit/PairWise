/** Virtual logical clock for commit timestamps. */
export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  
  tick(): number {
    return this.t;
  }
}
