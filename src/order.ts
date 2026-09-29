import type { Atom, Dot } from "./types.js";

/** RGA visible traversal — starter stub. */
export function visibleString(_atoms: Atom[]): string {
  throw new Error("visibleString not implemented");
}

export function visibleDotOrder(_atoms: Atom[]): Dot[] {
  throw new Error("visibleDotOrder not implemented");
}

export function childrenOf(_atoms: Atom[], _origin: Dot | null): Atom[] {
  throw new Error("childrenOf not implemented");
}
