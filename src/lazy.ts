import type { SegArrays } from "./types.js";

export function composeLazy(existing: number, delta: number): number {
  return existing + delta;
}

export function clearLazy(lazy: number[], idx: number): void {
  lazy[idx] = 0;
}

export function applyLazy(
  arrays: SegArrays,
  idx: number,
  leftBound: number,
  rightBound: number,
  delta: number,
): void {
  arrays.tree[idx] = arrays.tree[idx]! + delta * (rightBound - leftBound + 1);
  arrays.lazy[idx] = composeLazy(arrays.lazy[idx]!, delta);
}
