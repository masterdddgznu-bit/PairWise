import type { SegArrays } from "./types.js";
import { leftChild, midSplit, rightChild } from "./index_math.js";
import { pullUp } from "./push_pull.js";

export function buildFromLeaves(
  _arrays: SegArrays,
  _values: number[],
  _idx: number,
  _leftBound: number,
  _rightBound: number,
): void {
  if (_leftBound === _rightBound) {
    _arrays.tree[_idx] = _values[_leftBound] ?? 0;
    return;
  }
  const mid = midSplit(_leftBound, _rightBound);
  buildFromLeaves(_arrays, _values, leftChild(_idx), _leftBound, mid);
  buildFromLeaves(_arrays, _values, rightChild(_idx), mid + 1, _rightBound);
  pullUp(_arrays, _idx);
}
