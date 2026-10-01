import { SimHashError } from "./errors.js";
import type { SimHashStats } from "./types.js";

/** SimHash near-duplicate fingerprint — starter stub. */
export class SimHash {
  constructor(_bits: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_token: string, _weight = 1): void {
    throw new Error("add not implemented");
  }

  fingerprint(): number {
    throw new Error("fingerprint not implemented");
  }

  hamming(_other: SimHash): number {
    throw new Error("hamming not implemented");
  }

  similarity(_other: SimHash): number {
    throw new Error("similarity not implemented");
  }

  merge(_other: SimHash): void {
    throw new Error("merge not implemented");
  }

  exportAcc(): number[] {
    throw new Error("exportAcc not implemented");
  }

  static fromAcc(_bits: number, _seed: number, _acc: number[]): SimHash {
    throw new Error("fromAcc not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): SimHashStats {
    throw new Error("stats not implemented");
  }
}
