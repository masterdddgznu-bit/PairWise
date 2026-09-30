import { SketchError } from "./errors.js";

/** Dense 2D count table (depth rows x width columns). */
export class SketchTable {
  readonly data: number[][];

  constructor(
    readonly depth: number,
    readonly width: number,
  ) {
    this.data = Array.from({ length: depth }, () => new Array<number>(width).fill(0));
  }

  clone(): SketchTable {
    const copy = new SketchTable(this.depth, this.width);
    for (let r = 0; r < this.depth; r++) {
      copy.data[r] = [...this.data[r]!];
    }
    return copy;
  }

  export(): number[][] {
    return this.data.map((row) => [...row]);
  }

  static fromExport(table: number[][]): SketchTable {
    if (!Array.isArray(table) || table.length < 1) {
      throw new SketchError("table must have at least one row");
    }
    const width = table[0]!.length;
    if (width < 1) {
      throw new SketchError("table rows must not be empty");
    }
    for (const row of table) {
      if (!Array.isArray(row) || row.length !== width) {
        throw new SketchError("table rows must be equal length");
      }
      for (const v of row) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          throw new SketchError("table cells must be finite non-negative numbers");
        }
      }
    }
    const result = new SketchTable(table.length, width);
    for (let r = 0; r < table.length; r++) {
      result.data[r] = [...table[r]!];
    }
    return result;
  }
}
