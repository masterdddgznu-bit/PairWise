/** Seeded LCG (a=1664525, c=1013904223, m=2^32). NO Math.random. */
export class LcgRng {
  private static readonly A = 1664525;
  private static readonly C = 1013904223;
  private static readonly M = 4294967296;

  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state * LcgRng.A + LcgRng.C) >>> 0;
    return this.state;
  }

  nextFloat(): number {
    return this.next() / LcgRng.M;
  }

  getState(): number {
    return this.state;
  }

  static fromState(state: number): LcgRng {
    const rng = new LcgRng(0);
    rng.state = state >>> 0;
    return rng;
  }
}
