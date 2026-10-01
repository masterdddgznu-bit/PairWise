import { SimHashError } from "./errors.js";
import type { SimHashStats } from "./types.js";
import { fnv1a32 } from "./hash.js";
import { bitAt, fingerprintFromAcc, hammingDistance } from "./bits.js";

/** SimHash near-duplicate fingerprint. */
export class SimHash {
  private readonly bits: number;
  private readonly seed: number;
  private readonly acc: number[];
  private frozen = false;

  constructor(bits: number, seed: number) {
    if (!Number.isInteger(bits) || bits !== 32) {
      throw new SimHashError(`bits must be 32, got ${bits}`);
    }
    if (!Number.isInteger(seed) || seed < 0) {
      throw new SimHashError(`seed must be a non-negative integer, got ${seed}`);
    }
    this.bits = bits;
    this.seed = seed;
    this.acc = new Array<number>(bits).fill(0);
  }

  add(token: string, weight = 1): void {
    this.assertMutable();
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new SimHashError(`weight must be positive, got ${weight}`);
    }
    const hash = fnv1a32(token, this.seed);
    for (let i = 0; i < this.bits; i++) {
      this.acc[i] += bitAt(hash, i) ? weight : -weight;
    }
  }

  fingerprint(): number {
    return fingerprintFromAcc(this.acc, this.bits);
  }

  hamming(other: SimHash): number {
    this.assertCompatible(other);
    return hammingDistance(this.fingerprint(), other.fingerprint());
  }

  similarity(other: SimHash): number {
    return 1 - this.hamming(other) / this.bits;
  }

  merge(other: SimHash): void {
    this.assertMutable();
    this.assertCompatible(other);
    for (let i = 0; i < this.bits; i++) {
      this.acc[i] += other.acc[i];
    }
  }

  exportAcc(): number[] {
    return [...this.acc];
  }

  static fromAcc(bits: number, seed: number, acc: number[]): SimHash {
    const sh = new SimHash(bits, seed);
    if (!Array.isArray(acc) || acc.length !== bits) {
      throw new SimHashError(`acc must have length ${bits}`);
    }
    for (let i = 0; i < bits; i++) {
      if (!Number.isFinite(acc[i])) {
        throw new SimHashError(`acc[${i}] must be a finite number`);
      }
      sh.acc[i] = acc[i];
    }
    return sh;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SimHashStats {
    let nonZeroAcc = 0;
    for (const value of this.acc) {
      if (value !== 0) nonZeroAcc++;
    }
    return {
      bits: this.bits,
      seed: this.seed,
      frozen: this.frozen,
      nonZeroAcc,
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new SimHashError("SimHash is frozen");
    }
  }

  private assertCompatible(other: SimHash): void {
    if (!(other instanceof SimHash)) {
      throw new SimHashError("expected a SimHash instance");
    }
    if (other.bits !== this.bits || other.seed !== this.seed) {
      throw new SimHashError("SimHash parameter mismatch");
    }
  }
}
