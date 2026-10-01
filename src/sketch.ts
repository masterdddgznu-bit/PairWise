import { ThetaError } from "./errors.js";
import { hashKey } from "./hash.js";
import { compactSketch, FULL_THETA } from "./compact.js";
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
    this.assertMutable();
    const h = hashKey(key, this.seed);
    if (h >= this.theta) return;
    const idx = this.lowerBound(h);
    if (this.hashes[idx] === h) return;
    this.hashes.splice(idx, 0, h);
    if (this.hashes.length > this.k) this.compact();
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
    this.assertMutable();
    if (this.k !== other.k || this.seed !== other.seed) {
      throw new ThetaError("cannot merge sketches with different k or seed");
    }
    this.theta = Math.min(this.theta, other.theta);
    const merged: number[] = [];
    let i = 0;
    let j = 0;
    const a = this.hashes;
    const b = other.hashes;
    while (i < a.length || j < b.length) {
      let next: number;
      if (j >= b.length || (i < a.length && a[i]! < b[j]!)) {
        next = a[i]!;
        i++;
      } else {
        next = b[j]!;
        j++;
      }
      if (merged.length === 0 || merged[merged.length - 1] !== next) {
        if (next < this.theta) merged.push(next);
      }
    }
    this.hashes = merged;
    if (this.hashes.length > this.k) this.compact();
  }

  exportState(): ThetaState {
    return {
      k: this.k,
      seed: this.seed,
      theta: this.theta,
      hashes: [...this.hashes],
      frozen: this.frozen,
    };
  }

  static fromState(state: ThetaState): ThetaSketch {
    const ts = new ThetaSketch(state.k, state.seed);
    ts.theta = state.theta;
    ts.hashes = [...state.hashes].sort((a, b) => a - b);
    ts.frozen = state.frozen;
    return ts;
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

  private lowerBound(h: number): number {
    let lo = 0;
    let hi = this.hashes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.hashes[mid]! < h) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private assertMutable(): void {
    if (this.frozen) throw new ThetaError("sketch is frozen");
  }
}
