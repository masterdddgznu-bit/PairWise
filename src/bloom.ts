import { BloomError } from "./errors.js";
import { fnv1a32 } from "./hash.js";

/** Classic bit-array Bloom filter; bit strings are little-endian (LSB first). */
export class BloomFilter {
  private readonly bits: Uint8Array;

  constructor(
    readonly mBits: number,
    readonly kHashes: number,
  ) {
    if (!Number.isInteger(mBits) || mBits <= 0) {
      throw new BloomError("mBits must be a positive integer");
    }
    if (!Number.isInteger(kHashes) || kHashes <= 0) {
      throw new BloomError("kHashes must be a positive integer");
    }
    this.bits = new Uint8Array(mBits);
  }

  private positions(key: string): number[] {
    const positions: number[] = [];
    for (let i = 0; i < this.kHashes; i++) {
      positions.push(fnv1a32(key, i) % this.mBits);
    }
    return positions;
  }

  add(key: string): void {
    for (const position of this.positions(key)) {
      this.bits[position] = 1;
    }
  }

  mightContain(key: string): boolean {
    return this.positions(key).every((position) => this.bits[position] === 1);
  }

  toBits(): string {
    let out = "";
    for (let i = 0; i < this.mBits; i++) {
      out += this.bits[i] === 1 ? "1" : "0";
    }
    return out;
  }

  static fromBits(bits: string, k: number): BloomFilter {
    if (bits.length === 0) {
      throw new BloomError("bits must be a non-empty 0/1 string");
    }
    if (!Number.isInteger(k) || k <= 0) {
      throw new BloomError("kHashes must be a positive integer");
    }
    if (!/^[01]+$/.test(bits)) {
      throw new BloomError("bits may only contain '0' and '1'");
    }
    const filter = new BloomFilter(bits.length, k);
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === "1") filter.bits[i] = 1;
    }
    return filter;
  }

  union(other: BloomFilter): BloomFilter {
    if (other.mBits !== this.mBits || other.kHashes !== this.kHashes) {
      throw new BloomError("union requires filters with matching m and k");
    }
    const merged = new BloomFilter(this.mBits, this.kHashes);
    for (let i = 0; i < this.mBits; i++) {
      merged.bits[i] = this.bits[i] === 1 || other.bits[i] === 1 ? 1 : 0;
    }
    return merged;
  }
}
