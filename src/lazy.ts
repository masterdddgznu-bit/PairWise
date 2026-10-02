import type { SegArrays } from "./types.js";

export function composeLazy(_existing: number, _delta: number): number {
  throw new Error("composeLazy not implemented");
}

export function clearLazy(_lazy: number[], _idx: number): void {
  throw new Error("clearLazy not implemented");
}

export function applyLazy(
  _arrays: SegArrays,
  _idx: number,
  _leftBound: number,
  _rightBound: number,
  _delta: number,
): void {
  throw new Error("applyLazy not implemented");
}
