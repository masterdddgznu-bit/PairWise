import type { Delta, Entry, VersionVector } from "./types.js";

export function extractDelta(entries: Entry[], vv: VersionVector): Delta {
  return {
    entries: entries
      .filter((entry) => entry.dot.counter > (vv[entry.dot.replicaId] ?? 0))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  };
}
