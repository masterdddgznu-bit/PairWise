import { ThetaError } from "./errors.js";
import { compactSketch, FULL_THETA } from "./compact.js";
import { hashKey } from "./hash.js";
import type { ThetaState, ThetaStats } from "./types.js";

const MIN_K = 2;
const MAX_K = 4096;

/** Theta Sketch distinct-count estimator. */
export class ThetaSketch {
  private readonly k: number;
  private readonly seed: number;
  private theta: number = FULL_THETA;
  private hashes: number[] = [];
  private frozen = false;

  constructor(k: number, seed: number) {
    if (!Number.isInteger(k) || k < MIN_K || k > MAX_K) {
      throw new ThetaError(`k must be an integer in [${MIN_K}, ${MAX_K}]`);
    }
    this.k = k;
    this.seed = seed;
  }

  add(key: string): void {
    if (this.frozen) {
      throw new ThetaError("cannot add to a frozen sketch");
    }
    const h = hashKey(key, this.seed);
    if (h >= this.theta || this.hashes.includes(h)) {
      return;
    }
    this.hashes.push(h);
    if (this.hashes.length > this.k) {
      this.compact();
    }
  }

  estimate(): number {
    return (this.hashes.length * FULL_THETA) / this.theta;
  }

  thetaValue(): number {
    return this.theta;
  }

  retained(): number {
    return this.hashes.length;
  }

  merge(other: ThetaSketch): void {
    if (this.frozen) {
      throw new ThetaError("cannot merge into a frozen sketch");
    }
    if (other.k !== this.k || other.seed !== this.seed) {
      throw new ThetaError("cannot merge sketches with different k or seed");
    }
    const theta = Math.min(this.theta, other.theta);
    const union = new Set<number>();
    for (const h of this.hashes) {
      if (h < theta) union.add(h);
    }
    for (const h of other.hashes) {
      if (h < theta) union.add(h);
    }
    this.theta = theta;
    this.hashes = [...union];
    if (this.hashes.length > this.k) {
      this.compact();
    }
  }

  exportState(): ThetaState {
    return {
      k: this.k,
      seed: this.seed,
      theta: this.theta,
      hashes: [...this.hashes].sort((a, b) => a - b),
      frozen: this.frozen,
    };
  }

  static fromState(state: ThetaState): ThetaSketch {
    const sketch = new ThetaSketch(state.k, state.seed);
    sketch.theta = state.theta;
    sketch.hashes = [...state.hashes].sort((a, b) => a - b);
    sketch.frozen = state.frozen;
    return sketch;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): ThetaStats {
    return {
      k: this.k,
      seed: this.seed,
      theta: this.theta,
      retained: this.hashes.length,
      frozen: this.frozen,
    };
  }

  private compact(): void {
    const result = compactSketch(this.hashes, this.k);
    this.hashes = result.hashes;
    this.theta = result.theta;
  }
}
