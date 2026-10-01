import { LossyError } from "./errors.js";
import type { LossyEntry, LossyStats } from "./types.js";

/** Lossy Counting frequent-item sketch — starter stub. */
export class LossyCounter {
  constructor(_epsilon: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_key: string): void {
    throw new Error("add not implemented");
  }

  estimate(_key: string): number {
    throw new Error("estimate not implemented");
  }

  upperBound(_key: string): number {
    throw new Error("upperBound not implemented");
  }

  mightFrequent(_key: string, _support: number): boolean {
    throw new Error("mightFrequent not implemented");
  }

  merge(_other: LossyCounter): void {
    throw new Error("merge not implemented");
  }

  exportEntries(): LossyEntry[] {
    throw new Error("exportEntries not implemented");
  }

  static fromEntries(
    _epsilon: number,
    _N: number,
    _entries: LossyEntry[],
  ): LossyCounter {
    throw new Error("fromEntries not implemented");
  }

  countStream(): number {
    throw new Error("countStream not implemented");
  }

  bucket(): number {
    throw new Error("bucket not implemented");
  }

  size(): number {
    throw new Error("size not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): LossyStats {
    throw new Error("stats not implemented");
  }
}
