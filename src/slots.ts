import type { SSEntry } from "./types.js";

/**
 * Index of the entry with the smallest count; ties resolve to the
 * lexicographically smallest key. Returns -1 for an empty list.
 */
export function findMinEntryIndex(entries: SSEntry[]): number {
  let best = -1;
  for (let i = 0; i < entries.length; i++) {
    if (best === -1) {
      best = i;
      continue;
    }
    const cur = entries[i];
    const min = entries[best];
    if (cur.count < min.count || (cur.count === min.count && cur.key < min.key)) {
      best = i;
    }
  }
  return best;
}
