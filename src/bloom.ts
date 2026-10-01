import { BloomError } from "./errors.js";
import { positionsForKey } from "./positions.js";
import type { BloomStats } from "./types.js";

const MAX_COUNT = 65535;

/** Deterministic Counting Bloom Filter backed by 16-bit counters. */
export class CountingBloom {
  private readonly width: number;
  private readonly hashes: number;
  private readonly seed: number;
  private readonly counters: Uint16Array;
  private frozen = false;

  constructor(width: number, hashes: number, seed: number) {
    if (!Number.isInteger(width) || width < 8 || width > 65536) {
      throw new BloomError(`invalid width: ${width}`);
    }
    if (!Number.isInteger(hashes) || hashes < 1 || hashes > 16) {
      throw new BloomError(`invalid hashes: ${hashes}`);
    }
    this.width = width;
    this.hashes = hashes;
    this.seed = seed;
    this.counters = new Uint16Array(width);
  }

  private assertMutable(): void {
    if (this.frozen) throw new BloomError("filter is frozen");
  }

  private static assertValidN(n: number): void {
    if (!Number.isInteger(n) || n <= 0) {
      throw new BloomError(`invalid n: ${n}`);
    }
  }

  private positions(key: string): number[] {
    return positionsForKey(key, this.width, this.hashes, this.seed);
  }

  add(key: string, n = 1): void {
    this.assertMutable();
    CountingBloom.assertValidN(n);
    for (const pos of this.positions(key)) {
      const next = this.counters[pos] + n;
      this.counters[pos] = next > MAX_COUNT ? MAX_COUNT : next;
    }
  }

  remove(key: string, n = 1): void {
    this.assertMutable();
    CountingBloom.assertValidN(n);
    for (const pos of this.positions(key)) {
      const next = this.counters[pos] - n;
      this.counters[pos] = next < 0 ? 0 : next;
    }
  }

  mightContain(key: string): boolean {
    for (const pos of this.positions(key)) {
      if (this.counters[pos] === 0) return false;
    }
    return true;
  }

  estimateCount(key: string): number {
    let min = Infinity;
    for (const pos of this.positions(key)) {
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
      throw new BloomError("merge requires matching width, hashes and seed");
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
    if (counters.length !== width) {
      throw new BloomError(
        `counters length ${counters.length} does not match width ${width}`,
      );
    }
    for (let i = 0; i < width; i++) {
      const value = counters[i];
      if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
        throw new BloomError(`invalid counter value at ${i}: ${value}`);
      }
      bf.counters[i] = value;
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
