import type { Delta, VersionVector } from "./types.js";
import type { AtomStore } from "./atoms.js";
import { cmpDotAsc } from "./dot.js";
import { vvGet } from "./vv.js";

export function extractDelta(store: AtomStore, vv: VersionVector): Delta {
  const atoms = store
    .all()
    .filter((a) => a.id.counter > vvGet(vv, a.id.replicaId))
    .sort((x, y) => cmpDotAsc(x.id, y.id));
  return { atoms };
}

export function applyDeltaToStore(store: AtomStore, delta: Delta): void {
  store.mergeAtoms(delta.atoms);
}
