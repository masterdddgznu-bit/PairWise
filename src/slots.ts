import type { SSEntry } from "./types.js";

/** Min-entry lookup: smallest count, ties broken by lexicographically smallest key. */
export function findMinEntryIndex(entries: SSEntry[]): number {
  if (entries.length === 0) return -1;
  let minIndex = 0;
  for (let i = 1; i < entries.length; i++) {
    const cur = entries[i];
    const min = entries[minIndex];
    if (cur.count < min.count || (cur.count === min.count && cur.key < min.key)) {
      minIndex = i;
    }
  }
  return minIndex;
}
