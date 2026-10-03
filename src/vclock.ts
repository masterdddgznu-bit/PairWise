import type { VectorClock } from "./types.js";

export function zero(nodes: string[]): VectorClock {
  const vc: VectorClock = {};
  for (const n of nodes) vc[n] = 0;
  return vc;
}
export function copy(vc: VectorClock): VectorClock {
  return { ...vc };
}
export function bumpSelf(vc: VectorClock, self: string): void {
  vc[self] = (vc[self] ?? 0) + 1;
}
