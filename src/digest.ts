import { TDError } from "./errors.js";
import { sortCentroids, mergeAdjacentSameMean } from "./centroid.js";
import { compressCentroids } from "./compress.js";
import type { Centroid, TDigestStats } from "./types.js";

/** T-Digest streaming quantiles (deterministic simplified variant). */
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
    if (this.frozen) throw new TDError("digest is frozen");
    if (!Number.isFinite(x)) throw new TDError("x must be a finite number");
    if (!Number.isFinite(w) || w <= 0) {
      throw new TDError("weight must be a positive number");
    }
    this.centroids.push({ mean: x, weight: w });
    this.centroids = sortCentroids(this.centroids);
    this.totalWeight += w;
    if (this.centroids.length > this.compression) this.compress();
  }

  compress(): void {
    this.centroids = compressCentroids(this.centroids, this.compression);
  }

  quantile(q: number): number {
    if (typeof q !== "number" || Number.isNaN(q) || q < 0 || q > 1) {
      throw new TDError("q must be in [0, 1]");
    }
    if (this.centroids.length === 0) throw new TDError("empty digest");
    const first = this.centroids[0]!;
    const last = this.centroids[this.centroids.length - 1]!;
    if (q <= 0) return first.mean;
    if (q >= 1) return last.mean;
    const target = q * this.totalWeight;
    let cumulative = 0;
    for (let i = 0; i < this.centroids.length; i++) {
      const c = this.centroids[i]!;
      const before = cumulative;
      cumulative += c.weight;
      if (cumulative >= target) {
        if (i === 0) return c.mean;
        const prev = this.centroids[i - 1]!;
        const frac = (target - before) / c.weight;
        return prev.mean + frac * (c.mean - prev.mean);
      }
    }
    return last.mean;
  }

  cdf(x: number): number {
    if (this.centroids.length === 0) return 0;
    let less = 0;
    let equal = 0;
    for (const c of this.centroids) {
      if (c.mean < x) less += c.weight;
      else if (c.mean === x) equal += c.weight;
    }
    return (less + 0.5 * equal) / this.totalWeight;
  }

  merge(other: TDigest): void {
    if (this.frozen) throw new TDError("digest is frozen");
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
    return this.centroids.map((c) => ({ ...c }));
  }

  static fromCentroids(compression: number, centroids: Centroid[]): TDigest {
    const td = new TDigest(compression);
    for (const c of centroids) {
      if (!Number.isFinite(c.mean) || !Number.isFinite(c.weight) || c.weight <= 0) {
        throw new TDError("invalid centroid");
      }
    }
    td.centroids = mergeAdjacentSameMean(
      sortCentroids(centroids.map((c) => ({ ...c }))),
    );
    td.totalWeight = td.centroids.reduce((sum, c) => sum + c.weight, 0);
    return td;
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
}
