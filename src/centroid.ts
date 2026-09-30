import type { Centroid } from "./types.js";

/** Centroid helpers. */
export function sortCentroids(centroids: Centroid[]): Centroid[] {
  return [...centroids].sort((a, b) => a.mean - b.mean);
}

export function mergeAdjacentSameMean(centroids: Centroid[]): Centroid[] {
  const out: Centroid[] = [];
  for (const c of centroids) {
    const last = out[out.length - 1];
    if (last !== undefined && last.mean === c.mean) {
      last.weight += c.weight;
    } else {
      out.push({ mean: c.mean, weight: c.weight });
    }
  }
  return out;
}
