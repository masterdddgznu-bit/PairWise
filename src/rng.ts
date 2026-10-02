const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 4294967296; // 2^32

/** Seeded LCG — deterministic. NO Math.random. */
export class LcgRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state * MULTIPLIER + INCREMENT) >>> 0;
    return this.state;
  }

  nextFloat(): number {
    return this.next() / MODULUS;
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
