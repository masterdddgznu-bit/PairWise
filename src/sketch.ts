import { SketchError } from "./errors.js";
import type { SketchStats } from "./types.js";

/** Count-Min Sketch — starter stub. */
export class CountMinSketch {
  constructor(_depth: number, _width: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_key: string, _count = 1): void {
    throw new Error("add not implemented");
  }

  addConservative(_key: string, _count = 1): void {
    throw new Error("addConservative not implemented");
  }

  estimate(_key: string): number {
    throw new Error("estimate not implemented");
  }

  merge(_other: CountMinSketch): void {
    throw new Error("merge not implemented");
  }

  heavyHitters(_candidates: string[], _threshold: number): string[] {
    throw new Error("heavyHitters not implemented");
  }

  exportTable(): number[][] {
    throw new Error("exportTable not implemented");
  }

  static fromTable(_table: number[][]): CountMinSketch {
    throw new Error("fromTable not implemented");
  }

  totalAdded(): number {
    throw new Error("totalAdded not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): SketchStats {
    throw new Error("stats not implemented");
  }
}
