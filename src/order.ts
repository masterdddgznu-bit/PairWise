import type { Atom, Dot } from "./types.js";
import { cmpSiblingDesc, dotKey, sameDot } from "./dot.js";

const ROOT_KEY = "";

/** Depth-first RGA traversal; siblings ordered by Dot (counter, replicaId) desc. */
function traversalOrder(atoms: Atom[]): Atom[] {
  const known = new Set(atoms.map((a) => dotKey(a.id)));
  const children = new Map<string, Atom[]>();
  for (const atom of atoms) {
    const parentKey =
      atom.leftOrigin && known.has(dotKey(atom.leftOrigin))
        ? dotKey(atom.leftOrigin)
        : ROOT_KEY;
    const list = children.get(parentKey);
    if (list) list.push(atom);
    else children.set(parentKey, [atom]);
  }
  for (const list of children.values()) {
    list.sort((x, y) => cmpSiblingDesc(x.id, y.id));
  }
  const out: Atom[] = [];
  const walk = (key: string): void => {
    for (const child of children.get(key) ?? []) {
      out.push(child);
      walk(dotKey(child.id));
    }
  };
  walk(ROOT_KEY);
  return out;
}

export function visibleString(atoms: Atom[]): string {
  return traversalOrder(atoms)
    .filter((a) => a.value !== null)
    .map((a) => a.value)
    .join("");
}

export function visibleDotOrder(atoms: Atom[]): Dot[] {
  return traversalOrder(atoms)
    .filter((a) => a.value !== null)
    .map((a) => ({ ...a.id }));
}

export function childrenOf(atoms: Atom[], origin: Dot | null): Atom[] {
  return atoms
    .filter((a) =>
      a.leftOrigin === null || origin === null
        ? a.leftOrigin === null && origin === null
        : sameDot(a.leftOrigin, origin),
    )
    .sort((x, y) => cmpSiblingDesc(x.id, y.id));
}
