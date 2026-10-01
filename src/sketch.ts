import { SketchError } from "./errors.js";
import type { SketchStats } from "./types.js";
import { rowBucket, rowSign } from "./hash.js";
import { cloneTable, countNonZero, createTable } from "./table.js";

/** Count Sketch frequency estimator with median-of-rows estimate. */
export class CountSketch {
  private readonly depth: number;
  private readonly width: number;
  private readonly seed: number;
  private readonly table: number[][];
  private frozen = false;

  constructor(depth: number, width: number, seed: number) {
    if (!Number.isInteger(depth) || depth < 1 || depth > 16) {
      throw new SketchError(`depth must be an integer in [1, 16], got ${depth}`);
    }
    if (!Number.isInteger(width) || width < 2 || width > 4096) {
      throw new SketchError(`width must be an integer in [2, 4096], got ${width}`);
    }
    this.depth = depth;
    this.width = width;
    this.seed = seed >>> 0;
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
    const values: number[] = [];
    for (let r = 0; r < this.depth; r++) {
      const bucket = rowBucket(key, r, this.width, this.seed);
      values.push(rowSign(key, r, this.seed) * this.table[r]![bucket]!);
    }
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    if (values.length % 2 === 1) return values[mid]!;
    return (values[mid - 1]! + values[mid]!) / 2;
  }

  merge(other: CountSketch): void {
    this.assertMutable();
    if (
      this.depth !== other.depth ||
      this.width !== other.width ||
      this.seed !== other.seed
    ) {
      throw new SketchError("cannot merge sketches with different depth/width/seed");
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
    const sketch = new CountSketch(depth, width, seed);
    if (
      table.length !== depth ||
      table.some((row) => !Array.isArray(row) || row.length !== width)
    ) {
      throw new SketchError("table shape does not match depth/width");
    }
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
