import { MinHashError } from "./errors.js";
import type { MinHashStats } from "./types.js";
import {
  createEmptySignature,
  updateSignature,
  mergeSignatures,
  countFilled,
  estimateFromSignatures,
} from "./signature.js";

const MIN_K = 1;
const MAX_K = 256;

/** MinHash Jaccard sketch. */
export class MinHash {
  private readonly k: number;
  private readonly seed: number;
  private readonly sig: Uint32Array;
  private frozen = false;

  constructor(k: number, seed: number) {
    if (!Number.isInteger(k) || k < MIN_K || k > MAX_K) {
      throw new MinHashError(`k must be an integer in [${MIN_K}, ${MAX_K}]`);
    }
    this.k = k;
    this.seed = seed >>> 0;
    this.sig = createEmptySignature(k);
  }

  add(s: string): void {
    this.assertMutable();
    updateSignature(this.sig, s, this.seed);
  }

  estimateJaccard(other: MinHash): number {
    this.assertCompatible(other);
    return estimateFromSignatures(this.sig, other.sig);
  }

  merge(other: MinHash): void {
    this.assertMutable();
    this.assertCompatible(other);
    mergeSignatures(this.sig, other.sig);
  }

  exportSignature(): number[] {
    return Array.from(this.sig);
  }

  static fromSignature(k: number, seed: number, sig: number[]): MinHash {
    const mh = new MinHash(k, seed);
    if (!Array.isArray(sig) || sig.length !== mh.k) {
      throw new MinHashError(`signature must have exactly ${mh.k} slots`);
    }
    for (let i = 0; i < sig.length; i++) {
      const v = sig[i]!;
      if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
        throw new MinHashError("signature slots must be uint32 values");
      }
      mh.sig[i] = v;
    }
    return mh;
  }

  similarityBand(other: MinHash, bands: number, rows: number): boolean {
    this.assertCompatible(other);
    if (
      !Number.isInteger(bands) ||
      !Number.isInteger(rows) ||
      bands < 1 ||
      rows < 1 ||
      bands * rows !== this.k
    ) {
      throw new MinHashError("bands * rows must equal k");
    }
    for (let b = 0; b < bands; b++) {
      let match = true;
      const start = b * rows;
      for (let r = 0; r < rows; r++) {
        if (this.sig[start + r] !== other.sig[start + r]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): MinHashStats {
    return {
      k: this.k,
      seed: this.seed,
      frozen: this.frozen,
      filled: countFilled(this.sig),
    };
  }

  private assertMutable(): void {
    if (this.frozen) throw new MinHashError("MinHash is frozen");
  }

  private assertCompatible(other: MinHash): void {
    if (!(other instanceof MinHash) || other.k !== this.k || other.seed !== this.seed) {
      throw new MinHashError("MinHash parameter mismatch (k/seed)");
    }
  }
}
