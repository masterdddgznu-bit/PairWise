import type { Atom, VersionVector } from "./types.js";

export function vvGet(vv: VersionVector, id: string): number {
  return vv[id] ?? 0;
}

export function vvBump(vv: VersionVector, id: string, counter: number): VersionVector {
  const cur = vvGet(vv, id);
  if (counter <= cur) return { ...vv };
  return { ...vv, [id]: counter };
}

export function vvMin(vvs: VersionVector[]): VersionVector {
  if (vvs.length === 0) return {};
  const keys = new Set<string>();
  for (const v of vvs) for (const k of Object.keys(v)) keys.add(k);
  const out: VersionVector = {};
  for (const k of [...keys].sort()) {
    out[k] = Math.min(...vvs.map((v) => vvGet(v, k)));
  }
  return out;
}

export function vvFromAtoms(atoms: Atom[]): VersionVector {
  const out: VersionVector = {};
  for (const atom of atoms) {
    const cur = vvGet(out, atom.id.replicaId);
    if (atom.id.counter > cur) out[atom.id.replicaId] = atom.id.counter;
  }
  return out;
}
