/** Seeded LCG — starter stub. NO Math.random. */
export class LcgRng {
  constructor(_seed: number) {
    /* params accepted */
  }

  next(): number {
    throw new Error("next not implemented");
  }

  nextFloat(): number {
    throw new Error("nextFloat not implemented");
  }

  getState(): number {
    throw new Error("getState not implemented");
  }

  static fromState(_state: number): LcgRng {
    throw new Error("fromState not implemented");
  }
}
