import type { Dot } from "./types.js";

export function sameDot(a: Dot, b: Dot): boolean {
  return a.replicaId === b.replicaId && a.counter === b.counter;
}

export function dotKey(d: Dot): string {
  return `${d.replicaId}\0${d.counter}`;
}

export function cmpDotAsc(a: Dot, b: Dot): number {
  if (a.replicaId !== b.replicaId) return a.replicaId.localeCompare(b.replicaId);
  return a.counter - b.counter;
}

export function cmpDotDesc(a: Dot, b: Dot): number {
  return -cmpDotAsc(a, b);
}

/** Sibling order: larger (counter, replicaId) sorts closer to the parent. */
export function cmpSiblingDesc(a: Dot, b: Dot): number {
  if (a.counter !== b.counter) return b.counter - a.counter;
  return b.replicaId.localeCompare(a.replicaId);
}

export function sortDotsAsc(dots: Dot[]): Dot[] {
  return [...dots].sort(cmpDotAsc);
}
