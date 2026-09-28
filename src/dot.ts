import type { Dot } from "./types.js";

/** @returns positive if a wins over b */
export function cmpDot(a: Dot, b: Dot): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.replicaId === b.replicaId) return 0;
  return a.replicaId < b.replicaId ? -1 : 1;
}

export function dotWins(a: Dot, b: Dot): boolean {
  return cmpDot(a, b) > 0;
}
