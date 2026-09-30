import type { Centroid } from "./types.js";

/** Centroid helpers. */
export function sortCentroids(centroids: Centroid[]): Centroid[] {
  return [...centroids].sort((a, b) => a.mean - b.mean);
}

export function mergeAdjacentSameMean(centroids: Centroid[]): Centroid[] {
  const out: Centroid[] = [];
  for (const c of centroids) {
    const last = out[out.length - 1];
    if (last && toBeMerged(last, c)) {
      const w = last.weight + c.weight;
      last.mean = (last.mean * last.weight + c.mean * c.weight) / w;
      last.weight = w;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

function toBeMerged(a: Centroid, b: Centroid): boolean {
  return a.mean === b.mean;
}
