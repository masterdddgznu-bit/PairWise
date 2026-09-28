import type { Delta, Entry, VersionVector } from "./types.js";

export function extractDelta(_entries: Entry[], _vv: VersionVector): Delta {
  throw new Error("extractDelta not implemented");
}
