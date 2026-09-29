import { BloomError } from "./errors.js";
import { fnv1a32 } from "./hash.js";

/** Bloom filter over a fixed bit array with k FNV-1a hash positions. */
export class BloomFilter {
  readonly mBits: number;
  readonly kHashes: number;
  private readonly bits: Uint8Array;

  constructor(mBits: number, kHashes: number) {
    if (!Number.isInteger(mBits) || mBits <= 0) {
      throw new BloomError("mBits must be a positive integer");
    }
    if (!Number.isInteger(kHashes) || kHashes <= 0) {
      throw new BloomError("kHashes must be a positive integer");
    }
    this.mBits = mBits;
    this.kHashes = kHashes;
    this.bits = new Uint8Array(mBits);
  }

  private positions(key: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.kHashes; i++) {
      out.push(fnv1a32(key, i) % this.mBits);
    }
    return out;
  }

  add(key: string): void {
    for (const pos of this.positions(key)) {
      this.bits[pos] = 1;
    }
  }

  mightContain(key: string): boolean {
    for (const pos of this.positions(key)) {
      if (this.bits[pos] === 0) return false;
    }
    return true;
  }

  toBits(): string {
    let out = "";
    for (let i = 0; i < this.mBits; i++) {
      out += this.bits[i] === 1 ? "1" : "0";
    }
    return out;
  }

  static fromBits(bits: string, k: number): BloomFilter {
    if (bits.length === 0 || !/^[01]+$/.test(bits)) {
      throw new BloomError("bits must be a non-empty '0'/'1' string");
    }
    const bf = new BloomFilter(bits.length, k);
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === "1") bf.bits[i] = 1;
    }
    return bf;
  }

  union(other: BloomFilter): BloomFilter {
    if (other.mBits !== this.mBits || other.kHashes !== this.kHashes) {
      throw new BloomError("union requires matching mBits and kHashes");
    }
    const out = new BloomFilter(this.mBits, this.kHashes);
    for (let i = 0; i < this.mBits; i++) {
      out.bits[i] = this.bits[i] | other.bits[i];
    }
    return out;
  }
}
