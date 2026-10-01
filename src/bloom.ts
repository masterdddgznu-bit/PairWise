import { BloomError } from "./errors.js";
import type { BloomStats } from "./types.js";

/** Counting Bloom Filter — starter stub. */
export class CountingBloom {
  constructor(_width: number, _hashes: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_key: string, _n = 1): void {
    throw new Error("add not implemented");
  }

  remove(_key: string, _n = 1): void {
    throw new Error("remove not implemented");
  }

  mightContain(_key: string): boolean {
    throw new Error("mightContain not implemented");
  }

  estimateCount(_key: string): number {
    throw new Error("estimateCount not implemented");
  }

  merge(_other: CountingBloom): void {
    throw new Error("merge not implemented");
  }

  exportCounters(): number[] {
    throw new Error("exportCounters not implemented");
  }

  static fromCounters(
    _width: number,
    _hashes: number,
    _seed: number,
    _counters: number[],
  ): CountingBloom {
    throw new Error("fromCounters not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): BloomStats {
    throw new Error("stats not implemented");
  }
}
