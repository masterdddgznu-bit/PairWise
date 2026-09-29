import { BloomError } from "./errors.js";

/** Bloom filter — starter stub. */
export class BloomFilter {
  constructor(_mBits: number, _kHashes: number) {
    throw new BloomError("BloomFilter not implemented");
  }

  add(_key: string): void {
    throw new BloomError("add not implemented");
  }

  mightContain(_key: string): boolean {
    throw new BloomError("mightContain not implemented");
  }

  toBits(): string {
    throw new BloomError("toBits not implemented");
  }

  static fromBits(_bits: string, _k: number): BloomFilter {
    throw new BloomError("fromBits not implemented");
  }

  union(_other: BloomFilter): BloomFilter {
    throw new BloomError("union not implemented");
  }
}
