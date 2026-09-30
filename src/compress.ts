import type { Centroid } from "./types.js";

/**
 * Deterministic compression: repeatedly merge the adjacent pair with the
 * smallest combined weight (leftmost on ties) until length <= compression.
 */
export function compressCentroids(centroids: Centroid[], compression: number): Centroid[] {
  const out = centroids.map((c) => ({ mean: c.mean, weight: c.weight }));
  while (out.length > compression) {
    let best = 0;
    let bestWeight = out[0]!.weight + out[1]!.weight;
    for (let i = 1; i < out.length - 1; i++) {
      const w = out[i]!.weight + out[i + 1]!.weight;
      if (w < bestWeight) {
        best = i;
        bestWeight = w;
      }
    }
    const a = out[best]!;
    const b = out[best + 1]!;
    const weight = a.weight + b.weight;
    out.splice(best, 2, {
      mean: (a.mean * a.weight + b.mean * b.weight) / weight,
      weight,
    });
  }
  return out;
}
