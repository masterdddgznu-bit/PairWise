import type { VectorClock } from "./types.js";

export function zero(_nodes: string[]): VectorClock {
  return {};
}
export function copy(_vc: VectorClock): VectorClock {
  return {};
}
export function bumpSelf(_vc: VectorClock, _self: string): void {}
