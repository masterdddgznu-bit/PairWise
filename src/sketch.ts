import { SketchError } from "./errors.js";
import { fnv1a32 } from "./hash.js";
import { SketchTable } from "./table.js";
import type { SketchStats } from "./types.js";

function isPositiveInteger(n: number): boolean {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

/** Deterministic Count-Min Sketch over FNV-1a row hashes. */
export class CountMinSketch {
  private readonly table: SketchTable;
  private added = 0;
  private frozenFlag = false;

  constructor(
    readonly depth: number,
    readonly width: number,
  ) {
    if (!isPositiveInteger(depth)) {
      throw new SketchError("depth must be an integer >= 1");
    }
    if (
      typeof width !== "number" ||
      !Number.isInteger(width) ||
      width < 2 ||
      (width & (width - 1)) !== 0
    ) {
      throw new SketchError("width must be a power of two >= 2");
    }
    this.table = new SketchTable(depth, width);
  }

  private indexFor(key: string, row: number): number {
    return fnv1a32(key, row) % this.width;
  }

  add(key: string, count = 1): void {
    if (this.frozenFlag) {
      throw new SketchError("sketch is frozen");
    }
    if (!isPositiveInteger(count)) {
      throw new SketchError("count must be a positive integer");
    }
    for (let r = 0; r < this.depth; r++) {
      const idx = this.indexFor(key, r);
      this.table.data[r]![idx]! += count;
    }
    this.added += count;
  }

  addConservative(key: string, count = 1): void {
    if (this.frozenFlag) {
      throw new SketchError("sketch is frozen");
    }
    if (!isPositiveInteger(count)) {
      throw new SketchError("count must be a positive integer");
    }
    const indices: number[] = new Array(this.depth);
    let min = Infinity;
    for (let r = 0; r < this.depth; r++) {
      const idx = this.indexFor(key, r);
      indices[r] = idx;
      const value = this.table.data[r]![idx]!;
      if (value < min) min = value;
    }
    const target = min + count;
    for (let r = 0; r < this.depth; r++) {
      const cell = this.table.data[r]!;
      const idx = indices[r]!;
      if (cell[idx] === min) cell[idx] = target;
    }
    this.added += count;
  }

  estimate(key: string): number {
    let min = Infinity;
    for (let r = 0; r < this.depth; r++) {
      const value = this.table.data[r]![this.indexFor(key, r)]!;
      if (value < min) min = value;
    }
    return min === Infinity ? 0 : min;
  }

  merge(other: CountMinSketch): void {
    if (this.frozenFlag) {
      throw new SketchError("sketch is frozen");
    }
    if (other.depth !== this.depth || other.width !== this.width) {
      throw new SketchError("merge requires matching depth and width");
    }
    for (let r = 0; r < this.depth; r++) {
      const row = this.table.data[r]!;
      const otherRow = other.table.data[r]!;
      for (let c = 0; c < this.width; c++) {
        row[c]! += otherRow[c]!;
      }
    }
  }

  heavyHitters(candidates: string[], threshold: number): string[] {
    return candidates
      .filter((key) => this.estimate(key) >= threshold)
      .sort();
  }

  exportTable(): number[][] {
    return this.table.export();
  }

  static fromTable(table: number[][]): CountMinSketch {
    const imported = SketchTable.fromExport(table);
    const sketch = new CountMinSketch(imported.depth, imported.width);
    for (let r = 0; r < imported.depth; r++) {
      sketch.table.data[r] = [...imported.data[r]!];
    }
    return sketch;
  }

  totalAdded(): number {
    return this.added;
  }

  freeze(): void {
    this.frozenFlag = true;
  }

  stats(): SketchStats {
    return {
      depth: this.depth,
      width: this.width,
      totalAdded: this.added,
      frozen: this.frozenFlag,
    };
  }
}
