export interface Rng {
  nextInt(): number;
}
export class SeqRng implements Rng {
  private i = 0;
  constructor(private readonly vals: number[]) {}
  nextInt(): number {
    const v = this.vals[this.i % Math.max(this.vals.length, 1)] ?? 0;
    this.i += 1;
    return v >>> 0;
  }
}
