import { SketchError } from "./errors.js";
import type { SketchStats } from "./types.js";

/** Count Sketch frequency estimator — starter stub. */
export class CountSketch {
  constructor(_depth: number, _width: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  update(_key: string, _delta = 1): void {
    throw new Error("update not implemented");
  }

  estimate(_key: string): number {
    throw new Error("estimate not implemented");
  }

  merge(_other: CountSketch): void {
    throw new Error("merge not implemented");
  }

  exportTable(): number[][] {
    throw new Error("exportTable not implemented");
  }

  static fromTable(
    _depth: number,
    _width: number,
    _seed: number,
    _table: number[][],
  ): CountSketch {
    throw new Error("fromTable not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): SketchStats {
    throw new Error("stats not implemented");
  }
}
