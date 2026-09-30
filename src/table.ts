import { SketchError } from "./errors.js";

function isPow2(value: number): boolean {
  return value >= 2 && Number.isInteger(value) && (value & (value - 1)) === 0;
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/** Two-dimensional Count-Min counter storage (depth rows x width columns). */
export class SketchTable {
  readonly depth: number;
  readonly width: number;
  private readonly cells: number[][];

  constructor(depth: number, width: number) {
    if (!Number.isSafeInteger(depth) || depth < 1) {
      throw new SketchError("depth must be an integer >= 1");
    }
    if (!isPow2(width)) {
      throw new SketchError("width must be a power of two >= 2");
    }
    this.depth = depth;
    this.width = width;
    this.cells = Array.from({ length: depth }, () =>
      Array.from({ length: width }, () => 0),
    );
  }

  get(row: number, col: number): number {
    return this.cells[row]![col]!;
  }

  set(row: number, col: number, value: number): void {
    this.cells[row]![col] = value;
  }

  add(row: number, col: number, delta: number): void {
    this.cells[row]![col]! += delta;
  }

  /** Deep copy so exported data cannot mutate sketch internals. */
  clone(): SketchTable {
    const copy = new SketchTable(this.depth, this.width);
    for (let r = 0; r < this.depth; r++) {
      for (let c = 0; c < this.width; c++) {
        copy.cells[r]![c] = this.cells[r]![c]!;
      }
    }
    return copy;
  }

  export(): number[][] {
    return this.cells.map((row) => [...row]);
  }

  static fromExport(table: number[][]): SketchTable {
    if (!Array.isArray(table) || table.length < 1 || !Array.isArray(table[0])) {
      throw new SketchError("table must be a non-empty 2D array");
    }
    const depth = table.length;
    const width = table[0]!.length;
    if (!isPow2(width)) {
      throw new SketchError("width must be a power of two >= 2");
    }

    const result = new SketchTable(depth, width);
    for (let r = 0; r < depth; r++) {
      const row = table[r];
      if (!Array.isArray(row) || row.length !== width) {
        throw new SketchError("all table rows must share the same width");
      }
      for (let c = 0; c < width; c++) {
        if (!isCount(row[c])) {
          throw new SketchError("table cells must be non-negative integers");
        }
        result.cells[r]![c] = row[c] as number;
      }
    }
    return result;
  }
}
