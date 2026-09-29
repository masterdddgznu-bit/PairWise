import type { Delta, VersionVector } from "./types.js";
import { AtomStore, cloneAtom } from "./atoms.js";
import { cmpDotAsc } from "./dot.js";
import { vvGet } from "./vv.js";

export function extractDelta(store: AtomStore, vv: VersionVector): Delta {
  const atoms = store
    .all()
    .filter((atom) => atom.id.counter > vvGet(vv, atom.id.replicaId))
    .sort((a, b) => cmpDotAsc(a.id, b.id))
    .map(cloneAtom);
  return { atoms };
}

export function applyDeltaToStore(store: AtomStore, delta: Delta): void {
  for (const atom of delta.atoms) store.mergeAtom(atom);
}
