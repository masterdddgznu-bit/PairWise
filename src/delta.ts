import type { Delta, VersionVector } from "./types.js";
import type { TagStore } from "./tags.js";

export function extractDelta(_store: TagStore, _vv: VersionVector): Delta {
  throw new Error("extractDelta not implemented");
}

export function applyDeltaToStore(_store: TagStore, _delta: Delta): void {
  throw new Error("applyDelta not implemented");
}
