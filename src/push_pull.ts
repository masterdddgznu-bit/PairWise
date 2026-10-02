import type { SegArrays } from "./types.js";
import { leftChild, midSplit, rightChild } from "./index_math.js";
import { applyLazy, clearLazy } from "./lazy.js";

export function pushDown(
  _arrays: SegArrays,
  _idx: number,
  _leftBound: number,
  _rightBound: number,
): void {
  const pending = _arrays.lazy[_idx] ?? 0;
  if (pending === 0 || _leftBound === _rightBound) {
    return;
  }
  const mid = midSplit(_leftBound, _rightBound);
  applyLazy(_arrays, leftChild(_idx), _leftBound, mid, pending);
  applyLazy(_arrays, rightChild(_idx), mid + 1, _rightBound, pending);
  clearLazy(_arrays.lazy, _idx);
}

export function pullUp(_arrays: SegArrays, _idx: number): void {
  _arrays.tree[_idx] =
    (_arrays.tree[leftChild(_idx)] ?? 0) + (_arrays.tree[rightChild(_idx)] ?? 0);
}
