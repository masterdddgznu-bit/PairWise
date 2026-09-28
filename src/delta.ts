import type { Delta, TaggedElem, VersionVector } from "./types.js";
import type { TagStore } from "./tags.js";
import { cmpDot } from "./dot.js";
import { vvGet } from "./vv.js";

export function emptyDelta(): Delta {
  return { adds: [], removes: [] };
}

export function extractDelta(store: TagStore, vv: VersionVector): Delta {
  const adds: TaggedElem[] = [];
  const removes: TaggedElem[] = [];
  for (const { elem, live, tomb } of store.allTagged()) {
    for (const dot of live) {
      if (dot.counter > vvGet(vv, dot.replicaId)) adds.push({ elem, dot });
    }
    for (const dot of tomb) {
      if (dot.counter > vvGet(vv, dot.replicaId)) removes.push({ elem, dot });
    }
  }
  const cmp = (x: TaggedElem, y: TaggedElem): number => {
    if (x.elem !== y.elem) return x.elem.localeCompare(y.elem);
    return cmpDot(x.dot, y.dot);
  };
  adds.sort(cmp);
  removes.sort(cmp);
  return { adds, removes };
}

export function applyDeltaToStore(store: TagStore, delta: Delta): void {
  for (const { elem, dot } of delta.adds ?? []) {
    store.addTag(elem, dot);
  }
  for (const { elem, dot } of delta.removes ?? []) {
    store.tombstoneTag(elem, dot);
  }
}
