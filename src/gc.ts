import { vmax, zeros } from "./vclock.js";

export class StableGc {
  private readonly n: number;
  private readonly acks: number[][];

  constructor(n: number) {
    this.n = n;
    this.acks = Array.from({ length: n }, () => zeros(n));
  }

  ack(to: number, clock: number[]): void {
    this.acks[to] = vmax(this.acks[to], clock);
  }

  minStable(): number[] {
    const out = this.acks[0].slice();
    for (let i = 1; i < this.n; i++) {
      for (let d = 0; d < this.n; d++) {
        out[d] = Math.min(out[d], this.acks[i][d]);
      }
    }
    return out;
  }
}
