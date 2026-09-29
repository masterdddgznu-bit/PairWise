import type { Delta, VersionVector } from "./types.js";
import type { AtomStore } from "./atoms.js";

export function extractDelta(_store: AtomStore, _vv: VersionVector): Delta {
  throw new Error("extractDelta not implemented");
}

export function applyDeltaToStore(_store: AtomStore, _delta: Delta): void {
  throw new Error("applyDelta not implemented");
}
