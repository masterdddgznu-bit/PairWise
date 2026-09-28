import type { Dot } from "./types.js";

export function sameDot(a: Dot, b: Dot): boolean {
  return a.replicaId === b.replicaId && a.counter === b.counter;
}

export function cmpDot(a: Dot, b: Dot): number {
  if (a.replicaId !== b.replicaId) return a.replicaId.localeCompare(b.replicaId);
  return a.counter - b.counter;
}

export function sortDots(dots: Dot[]): Dot[] {
  return [...dots].sort(cmpDot);
}
