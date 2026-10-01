import type { CompactResult } from "./types.js";

export const FULL_THETA = 2 ** 32;

const MAX_UINT32 = 0xffffffff;

/** Compact hashes to capacity k, keeping the k smallest unique values. */
export function compactSketch(hashes: number[], k: number): CompactResult {
  const sorted = [...new Set(hashes)].sort((a, b) => a - b);
  if (sorted.length <= k) {
    return { hashes: sorted, theta: FULL_THETA };
  }
  const kept = sorted.slice(0, k);
  const last = kept[kept.length - 1]!;
  if (last === MAX_UINT32) {
    return { hashes: sorted, theta: FULL_THETA };
  }
  return { hashes: kept, theta: last + 1 };
}
