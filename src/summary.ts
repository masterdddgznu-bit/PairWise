import { GKError } from "./errors.js";
import type { GKTuple, GKStats } from "./types.js";

/** Greenwald-Khanna quantile summary — starter stub. */
export class GKSummary {
  constructor(_epsilon: number) {
    /* params accepted; methods throw until implemented */
  }

  insert(_x: number): void {
    throw new Error("insert not implemented");
  }

  compress(): void {
    throw new Error("compress not implemented");
  }

  quantile(_q: number): number {
    throw new Error("quantile not implemented");
  }

  merge(_other: GKSummary): void {
    throw new Error("merge not implemented");
  }

  exportTuples(): GKTuple[] {
    throw new Error("exportTuples not implemented");
  }

  static fromTuples(_epsilon: number, _tuples: GKTuple[]): GKSummary {
    throw new Error("fromTuples not implemented");
  }

  count(): number {
    throw new Error("count not implemented");
  }

  tupleCount(): number {
    throw new Error("tupleCount not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): GKStats {
    throw new Error("stats not implemented");
  }
}
