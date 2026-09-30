import { TDError } from "./errors.js";
import type { Centroid, TDigestStats } from "./types.js";
import { sortCentroids, mergeAdjacentSameMean } from "./centroid.js";
import { compressCentroids } from "./compress.js";

/** T-Digest streaming quantiles (deterministic simplified version). */
export class TDigest {
  private readonly compression: number;
  private centroids: Centroid[] = [];
  private totalWeight = 0;
  private frozen = false;

  constructor(compression: number) {
    if (!Number.isInteger(compression) || compression < 20) {
      throw new TDError("compression must be an integer >= 20");
    }
    this.compression = compression;
  }

  add(x: number, w = 1): void {
    this.assertMutable();
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) {
      throw new TDError("weight must be a positive number");
    }
    this.centroids.push({ mean: x, weight: w });
    this.centroids = sortCentroids(this.centroids);
    this.totalWeight += w;
    if (this.centroids.length > this.compression) {
      this.compress();
    }
  }

  compress(): void {
    if (this.centroids.length > this.compression) {
      this.centroids = compressCentroids(this.centroids, this.compression);
    }
  }

  quantile(q: number): number {
    if (typeof q !== "number" || Number.isNaN(q) || q < 0 || q > 1) {
      throw new TDError("q must be in [0, 1]");
    }
    if (this.centroids.length === 0) {
      throw new TDError("quantile of empty digest");
    }
    if (q <= 0) return this.centroids[0]!.mean;
    if (q >= 1) return this.centroids[this.centroids.length - 1]!.mean;
    const target = q * this.totalWeight;
    let cumulative = 0;
    for (let i = 0; i < this.centroids.length; i++) {
      const c = this.centroids[i]!;
      const prev = cumulative;
      cumulative += c.weight;
      if (target <= cumulative) {
        if (i === 0) return c.mean;
        const left = this.centroids[i - 1]!;
        const fraction = (target - prev) / (cumulative - prev);
        return left.mean + fraction * (c.mean - left.mean);
      }
    }
    return this.centroids[this.centroids.length - 1]!.mean;
  }

  cdf(x: number): number {
    if (this.centroids.length === 0 || this.totalWeight === 0) return 0;
    let below = 0;
    let equal = 0;
    for (const c of this.centroids) {
      if (c.mean < x) below += c.weight;
      else if (c.mean === x) equal += c.weight;
    }
    return (below + 0.5 * equal) / this.totalWeight;
  }

  merge(other: TDigest): void {
    this.assertMutable();
    if (other.compression !== this.compression) {
      throw new TDError("compression mismatch");
    }
    this.centroids = mergeAdjacentSameMean(
      sortCentroids([...this.centroids, ...other.centroids]),
    );
    this.totalWeight += other.totalWeight;
    this.compress();
  }

  exportCentroids(): Centroid[] {
    return this.centroids.map((c) => ({ mean: c.mean, weight: c.weight }));
  }

  static fromCentroids(compression: number, centroids: Centroid[]): TDigest {
    const digest = new TDigest(compression);
    digest.centroids = mergeAdjacentSameMean(sortCentroids(centroids));
    digest.totalWeight = digest.centroids.reduce((sum, c) => sum + c.weight, 0);
    return digest;
  }

  count(): number {
    return this.totalWeight;
  }

  centroidCount(): number {
    return this.centroids.length;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): TDigestStats {
    return {
      compression: this.compression,
      count: this.totalWeight,
      centroids: this.centroids.length,
      frozen: this.frozen,
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new TDError("digest is frozen");
    }
  }
}
