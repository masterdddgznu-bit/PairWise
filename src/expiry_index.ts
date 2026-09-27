import type { Entry } from "./types.js";

/** Helpers over entries ordered by expiry — stub. */
export function sortByExpiry(entries: Entry[]): Entry[] {
  void entries;
  return [];
}

export function dueEntries(entries: Entry[], _now: number): Entry[] {
  return [];
}
