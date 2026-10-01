import { BloomError } from "./errors.js";
import { positionsForKey } from "./positions.js";
import type { BloomStats } from "./types.js";

const MIN_WIDTH = 8;
const MAX_WIDTH = 65536;
const MIN_HASHES = 1;
const MAX_HASHES = 16;
const MAX_COUNT = 65535;

/** Deterministic Counting Bloom Filter with saturating 16-bit counters. */
export class CountingBloom {
  private readonly width: number;
  private readonly hashes: number;
  private readonly seed: number;
  private readonly counters: Uint16Array;
  private frozen = false;

  constructor(width: number, hashes: number, seed: number) {
    if (!Number.isInteger(width) || width < MIN_WIDTH || width > MAX_WIDTH) {
      throw new BloomError(`width must be an integer in [${MIN_WIDTH}, ${MAX_WIDTH}]`);
    }
    if (!Number.isInteger(hashes) || hashes < MIN_HASHES || hashes > MAX_HASHES) {
      throw new BloomError(`hashes must be an integer in [${MIN_HASHES}, ${MAX_HASHES}]`);
    }
    this.width = width;
    this.hashes = hashes;
    this.seed = seed;
    this.counters = new Uint16Array(width);
  }

  private assertMutable(): void {
    if (this.frozen) throw new BloomError("filter is frozen");
  }

  private static assertAmount(n: number): void {
    if (!Number.isInteger(n) || n <= 0) {
      throw new BloomError("n must be a positive integer");
    }
  }

  add(key: string, n = 1): void {
    this.assertMutable();
    CountingBloom.assertAmount(n);
    for (const pos of positionsForKey(key, this.width, this.hashes, this.seed)) {
      this.counters[pos] = Math.min(MAX_COUNT, this.counters[pos] + n);
    }
  }

  remove(key: string, n = 1): void {
    this.assertMutable();
    CountingBloom.assertAmount(n);
    for (const pos of positionsForKey(key, this.width, this.hashes, this.seed)) {
      this.counters[pos] = Math.max(0, this.counters[pos] - n);
    }
  }

  mightContain(key: string): boolean {
    for (const pos of positionsForKey(key, this.width, this.hashes, this.seed)) {
      if (this.counters[pos] === 0) return false;
    }
    return true;
  }

  estimateCount(key: string): number {
    let min = MAX_COUNT;
    for (const pos of positionsForKey(key, this.width, this.hashes, this.seed)) {
      if (this.counters[pos] < min) min = this.counters[pos];
    }
    return min;
  }

  merge(other: CountingBloom): void {
    this.assertMutable();
    if (
      this.width !== other.width ||
      this.hashes !== other.hashes ||
      this.seed !== other.seed
    ) {
      throw new BloomError("merge requires identical width, hashes and seed");
    }
    for (let i = 0; i < this.width; i++) {
      if (other.counters[i] > this.counters[i]) {
        this.counters[i] = other.counters[i];
      }
    }
  }

  exportCounters(): number[] {
    return Array.from(this.counters);
  }

  static fromCounters(
    width: number,
    hashes: number,
    seed: number,
    counters: number[],
  ): CountingBloom {
    const bf = new CountingBloom(width, hashes, seed);
    if (!Array.isArray(counters) || counters.length !== width) {
      throw new BloomError("counters must be an array of length width");
    }
    for (let i = 0; i < width; i++) {
      const v = counters[i];
      if (!Number.isInteger(v) || v < 0 || v > MAX_COUNT) {
        throw new BloomError(`counter ${i} must be an integer in [0, ${MAX_COUNT}]`);
      }
      bf.counters[i] = v;
    }
    return bf;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): BloomStats {
    let nonZero = 0;
    for (let i = 0; i < this.width; i++) {
      if (this.counters[i] > 0) nonZero++;
    }
    return {
      width: this.width,
      hashes: this.hashes,
      seed: this.seed,
      frozen: this.frozen,
      nonZero,
    };
  }
}
