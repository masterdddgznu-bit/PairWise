import type { Entry } from "./types.js";
import { sortByExpiry } from "./expiry_index.js";

/** Pick one victim for capacity eviction: earliest expireAt, ties by seq. */
export function pickVictim(entries: Entry[]): Entry | null {
  if (entries.length === 0) {
    return null;
  }
  return sortByExpiry(entries)[0];
}
