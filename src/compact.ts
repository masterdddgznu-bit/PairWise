import type { CompactResult } from "./types.js";

export const FULL_THETA = 2 ** 32;

/** Compact hashes to capacity k, keeping the k smallest. */
export function compactSketch(hashes: number[], k: number): CompactResult {
  const sorted = [...hashes].sort((a, b) => a - b);
  if (sorted.length <= k) {
    return { hashes: sorted, theta: FULL_THETA };
  }
  const kept = sorted.slice(0, k);
  const last = kept[k - 1]!;
  if (last === 0xffffffff) {
    return { hashes: sorted, theta: FULL_THETA };
  }
  return { hashes: kept, theta: last + 1 };
}
