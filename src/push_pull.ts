import type { SegArrays } from "./types.js";
import { applyLazy, clearLazy } from "./lazy.js";
import { leftChild, midSplit, rightChild } from "./index_math.js";

export function pushDown(
  arrays: SegArrays,
  idx: number,
  leftBound: number,
  rightBound: number,
): void {
  const pending = arrays.lazy[idx]!;
  if (pending === 0 || leftBound === rightBound) return;
  const mid = midSplit(leftBound, rightBound);
  applyLazy(arrays, leftChild(idx), leftBound, mid, pending);
  applyLazy(arrays, rightChild(idx), mid + 1, rightBound, pending);
  clearLazy(arrays.lazy, idx);
}

export function pullUp(arrays: SegArrays, idx: number): void {
  arrays.tree[idx] = arrays.tree[leftChild(idx)]! + arrays.tree[rightChild(idx)]!;
}
