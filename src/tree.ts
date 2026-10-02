import type { SegStats, SegTreeState } from "./types.js";

/** Deterministic range-sum segment tree with lazy add — starter stub. */
export class SegTree {
  constructor(_n: number) {
    /* params accepted; methods throw until implemented */
  }

  build(_values: number[]): void {
    throw new Error("build not implemented");
  }

  pointUpdate(_i: number, _value: number): void {
    throw new Error("pointUpdate not implemented");
  }

  rangeAdd(_l: number, _r: number, _delta: number): void {
    throw new Error("rangeAdd not implemented");
  }

  rangeSum(_l: number, _r: number): number {
    throw new Error("rangeSum not implemented");
  }

  pointQuery(_i: number): number {
    throw new Error("pointQuery not implemented");
  }

  exportState(): SegTreeState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: SegTreeState): SegTree {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): SegStats {
    throw new Error("stats not implemented");
  }
}
