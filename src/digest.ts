import { TDError } from "./errors.js";
import type { Centroid, TDigestStats } from "./types.js";

/** T-Digest streaming quantiles — starter stub. */
export class TDigest {
  constructor(_compression: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_x: number, _w = 1): void {
    throw new Error("add not implemented");
  }

  compress(): void {
    throw new Error("compress not implemented");
  }

  quantile(_q: number): number {
    throw new Error("quantile not implemented");
  }

  cdf(_x: number): number {
    throw new Error("cdf not implemented");
  }

  merge(_other: TDigest): void {
    throw new Error("merge not implemented");
  }

  exportCentroids(): Centroid[] {
    throw new Error("exportCentroids not implemented");
  }

  static fromCentroids(_compression: number, _centroids: Centroid[]): TDigest {
    throw new Error("fromCentroids not implemented");
  }

  count(): number {
    throw new Error("count not implemented");
  }

  centroidCount(): number {
    throw new Error("centroidCount not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): TDigestStats {
    throw new Error("stats not implemented");
  }
}
