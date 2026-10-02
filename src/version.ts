import type { KVEntry } from "./types.js";

/** Pick highest-version entry; BUG: returns first defined. */
export function pickHighest(entries: (KVEntry | undefined)[]): KVEntry | undefined {
  for (const e of entries) {
    if (e !== undefined) return e;
  }
  return undefined;
}

export function maxVersion(entries: (KVEntry | undefined)[]): number {
  let m = 0;
  for (const e of entries) {
    if (e && e.version > m) m = e.version;
  }
  return m;
}

/** BUG: does not increment. */
export function nextVersion(seenMax: number): number {
  return seenMax;
}
