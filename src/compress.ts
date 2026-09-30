import type { Centroid } from "./types.js";

/**
 * Deterministic compression: while there are more centroids than the
 * compression target, merge the adjacent pair with the smallest combined
 * weight (ties resolved to the leftmost pair).
 */
export function compressCentroids(centroids: Centroid[], compression: number): Centroid[] {
  const cs = centroids.map((c) => ({ ...c }));
  while (cs.length > compression) {
    let bestIdx = 0;
    let bestSum = Infinity;
    for (let i = 0; i < cs.length - 1; i++) {
      const sum = cs[i]!.weight + cs[i + 1]!.weight;
      if (sum < bestSum) {
        bestSum = sum;
        bestIdx = i;
      }
    }
    const a = cs[bestIdx]!;
    const b = cs[bestIdx + 1]!;
    const w = a.weight + b.weight;
    cs.splice(bestIdx, 2, {
      mean: (a.mean * a.weight + b.mean * b.weight) / w,
      weight: w,
    });
  }
  return cs;
}
