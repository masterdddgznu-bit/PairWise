import { vmax, zeros } from "./vclock.js";

export class StableGc {
  private readonly acks: number[][];

  constructor(n: number) {
    this.acks = Array.from({ length: n }, () => zeros(n));
  }

  ack(to: number, clock: number[]): void {
    this.acks[to] = vmax(this.acks[to], clock);
  }

  minStable(n: number): number[] {
    const out = this.acks[0].slice();
    for (let i = 1; i < this.acks.length; i++) {
      for (let d = 0; d < n; d++) {
        out[d] = Math.min(out[d], this.acks[i][d]);
      }
    }
    return out;
  }

  collect(_n: number): void {
    // Collection is orchestrated by VecBuf via CausalBuffer.gc(minStable, to).
  }
}
