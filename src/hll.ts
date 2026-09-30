import { HllError } from "./errors.js";
import type { HllStats } from "./types.js";

/** HyperLogLog — starter stub. */
export class HyperLogLog {
  constructor(_precision: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_key: string): void {
    throw new Error("add not implemented");
  }

  estimate(): number {
    throw new Error("estimate not implemented");
  }

  merge(_other: HyperLogLog): void {
    throw new Error("merge not implemented");
  }

  exportRegisters(): number[] {
    throw new Error("exportRegisters not implemented");
  }

  static fromRegisters(_regs: number[]): HyperLogLog {
    throw new Error("fromRegisters not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  isFrozen(): boolean {
    throw new Error("isFrozen not implemented");
  }

  zeros(): number {
    throw new Error("zeros not implemented");
  }

  stats(): HllStats {
    throw new Error("stats not implemented");
  }
}
