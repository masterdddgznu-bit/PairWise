import type { SegArrays } from "./types.js";
import { leftChild, midSplit, rightChild } from "./index_math.js";
import { pullUp } from "./push_pull.js";

export function buildFromLeaves(
  arrays: SegArrays,
  values: number[],
  idx: number,
  leftBound: number,
  rightBound: number,
): void {
  if (leftBound === rightBound) {
    arrays.tree[idx] = values[leftBound]!;
    return;
  }
  const mid = midSplit(leftBound, rightBound);
  buildFromLeaves(arrays, values, leftChild(idx), leftBound, mid);
  buildFromLeaves(arrays, values, rightChild(idx), mid + 1, rightBound);
  pullUp(arrays, idx);
}
