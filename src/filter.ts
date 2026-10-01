import { XorError } from "./errors.js";
import type { XorStats } from "./types.js";

/** XOR-lite accum filter — starter stub. */
export class XorFilter {
  constructor(_seed: number) {
    /* seed accepted; methods throw until implemented */
  }

  add(_key: string): void {
    throw new Error("add not implemented");
  }

  build(): void {
    throw new Error("build not implemented");
  }

  contains(_key: string): boolean {
    throw new Error("contains not implemented");
  }

  isBuilt(): boolean {
    throw new Error("isBuilt not implemented");
  }

  size(): number {
    throw new Error("size not implemented");
  }

  merge(_other: XorFilter): void {
    throw new Error("merge not implemented");
  }

  exportTable(): number[] {
    throw new Error("exportTable not implemented");
  }

  static fromTable(
    _seed: number,
    _m: number,
    _table: number[],
    _size: number,
  ): XorFilter {
    throw new Error("fromTable not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): XorStats {
    throw new Error("stats not implemented");
  }
}
