import { SketchError } from "./errors.js";
import { fnv1a32 } from "./hash.js";
import { SketchTable } from "./table.js";
import type { SketchStats } from "./types.js";

function isPow2(value: number): boolean {
  return value >= 2 && Number.isInteger(value) && (value & (value - 1)) === 0;
}

function assertPositiveInteger(count: number): void {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new SketchError("count must be a positive integer");
  }
}

/** Deterministic Count-Min Sketch over FNV-1a multi-row hashing. */
export class CountMinSketch {
  private readonly depth: number;
  private readonly width: number;
  private readonly table: SketchTable;
  private added = 0;
  private frozen = false;

  constructor(depth: number, width: number) {
    if (!Number.isSafeInteger(depth) || depth < 1) {
      throw new SketchError("depth must be an integer >= 1");
    }
    if (!isPow2(width)) {
      throw new SketchError("width must be a power of two >= 2");
    }
    this.depth = depth;
    this.width = width;
    this.table = new SketchTable(depth, width);
  }

  private indexFor(key: string, row: number): number {
    return fnv1a32(key, row) % this.width;
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new SketchError("sketch is frozen");
    }
  }

  /** Standard Count-Min add: increment every hashed row cell. */
  add(key: string, count = 1): void {
    this.assertMutable();
    assertPositiveInteger(count);
    for (let r = 0; r < this.depth; r++) {
      this.table.add(r, this.indexFor(key, r), count);
    }
    this.added += count;
  }

  /**
   * Conservative update: raise only the minimum-valued cells so that the
   * item's lower-bound estimate increases by exactly `count`.
   */
  addConservative(key: string, count = 1): void {
    this.assertMutable();
    assertPositiveInteger(count);

    const indices: number[] = new Array(this.depth);
    let minimum = Infinity;
    for (let r = 0; r < this.depth; r++) {
      indices[r] = this.indexFor(key, r);
      const value = this.table.get(r, indices[r]!);
      if (value < minimum) minimum = value;
    }

    const target = (minimum as number) + count;
    for (let r = 0; r < this.depth; r++) {
      if (this.table.get(r, indices[r]!) === minimum) {
        this.table.set(r, indices[r]!, target);
      }
    }
    this.added += count;
  }

  /** Lower-bound estimate: minimum across all hashed rows. */
  estimate(key: string): number {
    let minimum = Infinity;
    for (let r = 0; r < this.depth; r++) {
      const value = this.table.get(r, this.indexFor(key, r));
      if (value < minimum) minimum = value;
    }
    return minimum as number;
  }

  /** Cellwise sum merge with a dimension-matching sketch. */
  merge(other: CountMinSketch): void {
    this.assertMutable();
    if (other.depth !== this.depth || other.width !== this.width) {
      throw new SketchError("merge requires matching depth and width");
    }
    const otherTable = other.exportTable();
    for (let r = 0; r < this.depth; r++) {
      for (let c = 0; c < this.width; c++) {
        this.table.add(r, c, otherTable[r]![c]!);
      }
    }
  }

  /** Candidates whose estimate meets the threshold, sorted lexicographically. */
  heavyHitters(candidates: string[], threshold: number): string[] {
    return candidates
      .filter((key) => this.estimate(key) >= threshold)
      .sort();
  }

  exportTable(): number[][] {
    return this.table.export();
  }

  static fromTable(table: number[][]): CountMinSketch {
    const restored = SketchTable.fromExport(table);
    const sketch = new CountMinSketch(restored.depth, restored.width);
    for (let r = 0; r < restored.depth; r++) {
      for (let c = 0; c < restored.width; c++) {
        sketch.table.set(r, c, restored.get(r, c));
      }
    }
    return sketch;
  }

  totalAdded(): number {
    return this.added;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SketchStats {
    return {
      depth: this.depth,
      width: this.width,
      totalAdded: this.added,
      frozen: this.frozen,
    };
  }
}
