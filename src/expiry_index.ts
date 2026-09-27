import type { Entry } from "./types.js";

/** Helpers over entries ordered by expiry. */
export function sortByExpiry(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.expireAt - b.expireAt || a.seq - b.seq);
}

export function dueEntries(entries: Entry[], now: number): Entry[] {
  return sortByExpiry(entries.filter((e) => e.expireAt <= now));
}
