import { SketchError } from "./errors.js";
import { rowBucket, rowSign } from "./hash.js";
import { cloneTable, countNonZero, createTable } from "./table.js";
import type { SketchStats } from "./types.js";

const MIN_DEPTH = 1;
const MAX_DEPTH = 16;
const MIN_WIDTH = 2;
const MAX_WIDTH = 4096;

function validateParams(depth: number, width: number): void {
  if (!Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) {
    throw new SketchError(`depth must be an integer in [${MIN_DEPTH}, ${MAX_DEPTH}]`);
  }
  if (!Number.isInteger(width) || width < MIN_WIDTH || width > MAX_WIDTH) {
    throw new SketchError(`width must be an integer in [${MIN_WIDTH}, ${MAX_WIDTH}]`);
  }
}

/** Count Sketch frequency estimator with median-of-rows estimates. */
export class CountSketch {
  private readonly depth: number;
  private readonly width: number;
  private readonly seed: number;
  private readonly table: number[][];
  private frozen = false;

  constructor(depth: number, width: number, seed: number) {
    validateParams(depth, width);
    this.depth = depth;
    this.width = width;
    this.seed = seed;
    this.table = createTable(depth, width);
  }

  update(key: string, delta = 1): void {
    this.assertMutable();
    for (let r = 0; r < this.depth; r++) {
      const bucket = rowBucket(key, r, this.width, this.seed);
      this.table[r]![bucket]! += rowSign(key, r, this.seed) * delta;
    }
  }

  estimate(key: string): number {
    const estimates = new Array<number>(this.depth);
    for (let r = 0; r < this.depth; r++) {
      const bucket = rowBucket(key, r, this.width, this.seed);
      estimates[r] = rowSign(key, r, this.seed) * this.table[r]![bucket]!;
    }
    estimates.sort((a, b) => a - b);
    const mid = this.depth >> 1;
    if (this.depth % 2 === 1) return estimates[mid]!;
    return (estimates[mid - 1]! + estimates[mid]!) / 2;
  }

  merge(other: CountSketch): void {
    this.assertMutable();
    if (
      this.depth !== other.depth ||
      this.width !== other.width ||
      this.seed !== other.seed
    ) {
      throw new SketchError("cannot merge sketches with different depth, width, or seed");
    }
    for (let r = 0; r < this.depth; r++) {
      for (let c = 0; c < this.width; c++) {
        this.table[r]![c]! += other.table[r]![c]!;
      }
    }
  }

  exportTable(): number[][] {
    return cloneTable(this.table);
  }

  static fromTable(
    depth: number,
    width: number,
    seed: number,
    table: number[][],
  ): CountSketch {
    validateParams(depth, width);
    if (table.length !== depth || table.some((row) => row.length !== width)) {
      throw new SketchError("table dimensions do not match depth and width");
    }
    const sketch = new CountSketch(depth, width, seed);
    for (let r = 0; r < depth; r++) {
      for (let c = 0; c < width; c++) {
        sketch.table[r]![c] = table[r]![c]!;
      }
    }
    return sketch;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SketchStats {
    return {
      depth: this.depth,
      width: this.width,
      seed: this.seed,
      frozen: this.frozen,
      nonZero: countNonZero(this.table),
    };
  }

  private assertMutable(): void {
    if (this.frozen) throw new SketchError("sketch is frozen");
  }
}
