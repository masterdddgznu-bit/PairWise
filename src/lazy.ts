import type { SegArrays } from "./types.js";

export function composeLazy(_existing: number, _delta: number): number {
  return _existing + _delta;
}

export function clearLazy(_lazy: number[], _idx: number): void {
  _lazy[_idx] = 0;
}

export function applyLazy(
  _arrays: SegArrays,
  _idx: number,
  _leftBound: number,
  _rightBound: number,
  _delta: number,
): void {
  _arrays.tree[_idx] = (_arrays.tree[_idx] ?? 0) + _delta * (_rightBound - _leftBound + 1);
  _arrays.lazy[_idx] = composeLazy(_arrays.lazy[_idx] ?? 0, _delta);
}
