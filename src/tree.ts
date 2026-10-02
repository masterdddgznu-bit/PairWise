import type { SegStats, SegTreeState } from "./types.js";
import type { SegArrays } from "./types.js";
import { SegError } from "./errors.js";
import { leftChild, midSplit, rightChild } from "./index_math.js";
import { applyLazy } from "./lazy.js";
import { pullUp, pushDown } from "./push_pull.js";
import { buildFromLeaves } from "./build.js";

const MIN_N = 1;
const MAX_N = 256;

/** Deterministic range-sum segment tree with lazy add. */
export class SegTree {
  private readonly n: number;
  private readonly arrays: SegArrays;
  private frozen = false;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) {
      throw new SegError(`n must be an integer in [${MIN_N}, ${MAX_N}]`);
    }
    this.n = n;
    const capacity = 4 * n + 1;
    this.arrays = {
      tree: new Array<number>(capacity).fill(0),
      lazy: new Array<number>(capacity).fill(0),
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new SegError("SegTree is frozen");
    }
  }

  private assertIndex(i: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) {
      throw new SegError(`index ${i} out of range [0, ${this.n})`);
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
      throw new SegError(`invalid range [${l}, ${r}] for n=${this.n}`);
    }
  }

  build(values: number[]): void {
    this.assertMutable();
    if (!Array.isArray(values) || values.length !== this.n) {
      throw new SegError(`build expects exactly ${this.n} values`);
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
    if (l <= mid) {
      this.rangeAddRec(leftChild(idx), leftBound, mid, l, r, delta);
    }
    if (r > mid) {
      this.rangeAddRec(rightChild(idx), mid + 1, rightBound, l, r, delta);
    }
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
      return this.arrays.tree[idx] ?? 0;
    }
    pushDown(this.arrays, idx, leftBound, rightBound);
    const mid = midSplit(leftBound, rightBound);
    let sum = 0;
    if (l <= mid) {
      sum += this.rangeSumRec(leftChild(idx), leftBound, mid, l, r);
    }
    if (r > mid) {
      sum += this.rangeSumRec(rightChild(idx), mid + 1, rightBound, l, r);
    }
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
    if (
      state === null ||
      typeof state !== "object" ||
      !Array.isArray(state.tree) ||
      !Array.isArray(state.lazy)
    ) {
      throw new SegError("invalid SegTreeState");
    }
    const tree = new SegTree(state.n);
    const capacity = 4 * state.n + 1;
    if (state.tree.length !== capacity || state.lazy.length !== capacity) {
      throw new SegError(`state arrays must have length ${capacity}`);
    }
    tree.arrays.tree.splice(0, capacity, ...state.tree);
    tree.arrays.lazy.splice(0, capacity, ...state.lazy);
    tree.frozen = state.frozen === true;
    return tree;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SegStats {
    let pendingLazyCount = 0;
    for (const mark of this.arrays.lazy) {
      if (mark !== 0) {
        pendingLazyCount += 1;
      }
    }
    return {
      n: this.n,
      frozen: this.frozen,
      nodeCount: 4 * this.n,
      pendingLazyCount,
    };
  }
}
