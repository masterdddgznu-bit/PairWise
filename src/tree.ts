import type { SegArrays, SegStats, SegTreeState } from "./types.js";
import { SegError } from "./errors.js";
import { leftChild, midSplit, rightChild } from "./index_math.js";
import { applyLazy } from "./lazy.js";
import { pullUp, pushDown } from "./push_pull.js";
import { buildFromLeaves } from "./build.js";

/** Deterministic range-sum segment tree with lazy add. */
export class SegTree {
  private readonly n: number;
  private readonly arrays: SegArrays;
  private frozen = false;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > 256) {
      throw new SegError(`invalid n: ${n}`);
    }
    this.n = n;
    const capacity = 4 * n + 1;
    this.arrays = {
      tree: new Array<number>(capacity).fill(0),
      lazy: new Array<number>(capacity).fill(0),
    };
  }

  private assertMutable(): void {
    if (this.frozen) throw new SegError("tree is frozen");
  }

  private assertIndex(i: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) {
      throw new SegError(`index out of range: ${i}`);
    }
  }

  private assertRange(l: number, r: number): void {
    if (
      !Number.isInteger(l) ||
      !Number.isInteger(r) ||
      l < 0 ||
      r >= this.n ||
      l > r
    ) {
      throw new SegError(`invalid range: [${l}, ${r}]`);
    }
  }

  build(values: number[]): void {
    this.assertMutable();
    if (values.length !== this.n) {
      throw new SegError(`build length mismatch: ${values.length} !== ${this.n}`);
    }
    this.arrays.tree.fill(0);
    this.arrays.lazy.fill(0);
    buildFromLeaves(this.arrays, values, 1, 0, this.n - 1);
  }

  pointUpdate(i: number, value: number): void {
    this.assertMutable();
    this.assertIndex(i);
    this.pointUpdateRec(1, 0, this.n - 1, i, value);
  }

  private pointUpdateRec(
    idx: number,
    leftBound: number,
    rightBound: number,
    i: number,
    value: number,
  ): void {
    if (leftBound === rightBound) {
      this.arrays.tree[idx] = value;
      return;
    }
    pushDown(this.arrays, idx, leftBound, rightBound);
    const mid = midSplit(leftBound, rightBound);
    if (i <= mid) {
      this.pointUpdateRec(leftChild(idx), leftBound, mid, i, value);
    } else {
      this.pointUpdateRec(rightChild(idx), mid + 1, rightBound, i, value);
    }
    pullUp(this.arrays, idx);
  }

  rangeAdd(l: number, r: number, delta: number): void {
    this.assertMutable();
    this.assertRange(l, r);
    this.rangeAddRec(1, 0, this.n - 1, l, r, delta);
  }

  private rangeAddRec(
    idx: number,
    leftBound: number,
    rightBound: number,
    l: number,
    r: number,
    delta: number,
  ): void {
    if (l <= leftBound && rightBound <= r) {
      applyLazy(this.arrays, idx, leftBound, rightBound, delta);
      return;
    }
    pushDown(this.arrays, idx, leftBound, rightBound);
    const mid = midSplit(leftBound, rightBound);
    if (l <= mid) this.rangeAddRec(leftChild(idx), leftBound, mid, l, r, delta);
    if (r > mid) this.rangeAddRec(rightChild(idx), mid + 1, rightBound, l, r, delta);
    pullUp(this.arrays, idx);
  }

  rangeSum(l: number, r: number): number {
    this.assertRange(l, r);
    return this.rangeSumRec(1, 0, this.n - 1, l, r);
  }

  private rangeSumRec(
    idx: number,
    leftBound: number,
    rightBound: number,
    l: number,
    r: number,
  ): number {
    if (l <= leftBound && rightBound <= r) {
      return this.arrays.tree[idx]!;
    }
    pushDown(this.arrays, idx, leftBound, rightBound);
    const mid = midSplit(leftBound, rightBound);
    let sum = 0;
    if (l <= mid) sum += this.rangeSumRec(leftChild(idx), leftBound, mid, l, r);
    if (r > mid) sum += this.rangeSumRec(rightChild(idx), mid + 1, rightBound, l, r);
    return sum;
  }

  pointQuery(i: number): number {
    this.assertIndex(i);
    return this.rangeSumRec(1, 0, this.n - 1, i, i);
  }

  exportState(): SegTreeState {
    return {
      n: this.n,
      frozen: this.frozen,
      tree: [...this.arrays.tree],
      lazy: [...this.arrays.lazy],
    };
  }

  static fromState(state: SegTreeState): SegTree {
    const tree = new SegTree(state.n);
    const capacity = 4 * state.n + 1;
    if (state.tree.length !== capacity || state.lazy.length !== capacity) {
      throw new SegError("state array length mismatch");
    }
    tree.arrays.tree.splice(0, capacity, ...state.tree);
    tree.arrays.lazy.splice(0, capacity, ...state.lazy);
    tree.frozen = state.frozen;
    return tree;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SegStats {
    let pendingLazyCount = 0;
    for (const mark of this.arrays.lazy) {
      if (mark !== 0) pendingLazyCount += 1;
    }
    return {
      n: this.n,
      frozen: this.frozen,
      nodeCount: 4 * this.n,
      pendingLazyCount,
    };
  }
}
