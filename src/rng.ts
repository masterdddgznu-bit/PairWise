export type Bit = 0 | 1;
export interface Rng {
  nextBit(): Bit;
}
export class SeqRng implements Rng {
  private i = 0;
  constructor(private readonly bits: Bit[]) {}
  nextBit(): Bit {
    const b = this.bits[this.i % this.bits.length] ?? 0;
    this.i += 1;
    return b;
  }
}
