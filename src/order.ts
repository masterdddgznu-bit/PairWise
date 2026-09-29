import type { Atom, Dot } from "./types.js";
import { dotKey } from "./dot.js";

const ROOT_KEY = "";

function originKey(origin: Dot | null): string {
  return origin === null ? ROOT_KEY : dotKey(origin);
}

/** Siblings sort by Dot descending on (counter, replicaId). */
function cmpSiblingDesc(a: Atom, b: Atom): number {
  if (a.id.counter !== b.id.counter) return b.id.counter - a.id.counter;
  if (a.id.replicaId === b.id.replicaId) return 0;
  return a.id.replicaId < b.id.replicaId ? 1 : -1;
}

function orderedAtoms(atoms: Atom[]): Atom[] {
  const byOrigin = new Map<string, Atom[]>();
  for (const atom of atoms) {
    const key = originKey(atom.leftOrigin);
    const siblings = byOrigin.get(key);
    if (siblings === undefined) byOrigin.set(key, [atom]);
    else siblings.push(atom);
  }
  for (const siblings of byOrigin.values()) siblings.sort(cmpSiblingDesc);
  const out: Atom[] = [];
  const walk = (key: string): void => {
    const children = byOrigin.get(key);
    if (children === undefined) return;
    for (const child of children) {
      out.push(child);
      walk(dotKey(child.id));
    }
  };
  walk(ROOT_KEY);
  return out;
}

/** RGA visible traversal. */
export function visibleString(atoms: Atom[]): string {
  let out = "";
  for (const atom of orderedAtoms(atoms)) {
    if (atom.value !== null) out += atom.value;
  }
  return out;
}

export function visibleDotOrder(atoms: Atom[]): Dot[] {
  return orderedAtoms(atoms)
    .filter((atom) => atom.value !== null)
    .map((atom) => ({ ...atom.id }));
}

export function childrenOf(atoms: Atom[], origin: Dot | null): Atom[] {
  const key = originKey(origin);
  return atoms
    .filter((atom) => originKey(atom.leftOrigin) === key)
    .sort(cmpSiblingDesc);
}
