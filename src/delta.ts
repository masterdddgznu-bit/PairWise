import type { Delta, Entry, VersionVector } from "./types.js";
import { vvGet } from "./vv.js";
import type { EntryStore } from "./entries.js";

/**
 * Every entry (live or tombstone) whose dot is strictly newer than the
 * caller's known counter for its replica.
 */
export function extractDelta(entries: Entry[], vv: VersionVector): Delta {
  return {
    entries: entries
      .filter((e) => e.dot.counter > vvGet(vv, e.dot.replicaId))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}

/** LWW-merge every entry in a delta; out-of-order entries are tolerated. */
export function applyDelta(store: EntryStore, delta: Delta): void {
  for (const e of delta.entries) store.applyLww(e);
}
