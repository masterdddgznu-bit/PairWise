import { MinHashError } from "./errors.js";
import type { MinHashStats } from "./types.js";

/** MinHash Jaccard sketch — starter stub. */
export class MinHash {
  constructor(_k: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_s: string): void {
    throw new Error("add not implemented");
  }

  estimateJaccard(_other: MinHash): number {
    throw new Error("estimateJaccard not implemented");
  }

  merge(_other: MinHash): void {
    throw new Error("merge not implemented");
  }

  exportSignature(): number[] {
    throw new Error("exportSignature not implemented");
  }

  static fromSignature(_k: number, _seed: number, _sig: number[]): MinHash {
    throw new Error("fromSignature not implemented");
  }

  similarityBand(_other: MinHash, _bands: number, _rows: number): boolean {
    throw new Error("similarityBand not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): MinHashStats {
    throw new Error("stats not implemented");
  }
}
