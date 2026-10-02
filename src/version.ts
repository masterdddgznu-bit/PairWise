import type { KVEntry } from "./types.js";

/** Pick highest-version entry. */
export function pickHighest(entries: (KVEntry | undefined)[]): KVEntry | undefined {
  let best: KVEntry | undefined;
  for (const e of entries) {
    if (!e) continue;
    if (!best || e.version > best.version) best = e;
  }
  return best;
}

export function maxVersion(entries: (KVEntry | undefined)[]): number {
  let m = 0;
  for (const e of entries) {
    if (e && e.version > m) m = e.version;
  }
  return m;
}

export function nextVersion(seenMax: number): number {
  return seenMax + 1;
}
