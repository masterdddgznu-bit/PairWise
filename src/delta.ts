import type { Delta, VersionVector } from "./types.js";
import type { Dot } from "./types.js";
import type { TagStore } from "./tags.js";
import { vvGet } from "./vv.js";

function cmpTagged(a: { elem: string; dot: Dot }, b: { elem: string; dot: Dot }): number {
  if (a.elem !== b.elem) return a.elem < b.elem ? -1 : 1;
  if (a.dot.replicaId !== b.dot.replicaId) {
    return a.dot.replicaId < b.dot.replicaId ? -1 : 1;
  }
  return a.dot.counter - b.dot.counter;
}

/** All tag records (live -> adds, tombstoned -> removes) newer than vv. */
export function extractDelta(store: TagStore, vv: VersionVector): Delta {
  const adds: Delta["adds"] = [];
  const removes: Delta["removes"] = [];
  for (const { elem, live, tomb } of store.allTagged()) {
    for (const dot of live) {
      if (dot.counter > vvGet(vv, dot.replicaId)) adds.push({ elem, dot: { ...dot } });
    }
    for (const dot of tomb) {
      if (dot.counter > vvGet(vv, dot.replicaId)) removes.push({ elem, dot: { ...dot } });
    }
  }
  adds.sort(cmpTagged);
  removes.sort(cmpTagged);
  return { adds, removes };
}

export function applyDeltaToStore(store: TagStore, delta: Delta): void {
  for (const { elem, dot } of delta.adds ?? []) store.addTag(elem, dot);
  for (const { elem, dot } of delta.removes ?? []) store.tombstoneDot(elem, dot);
}
