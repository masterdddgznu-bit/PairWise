import { HllError } from "./errors.js";
import type { HllStats } from "./types.js";
import { fnv1a32 } from "./hash.js";
import { rhoFromHash } from "./rho.js";
import { estimateFromRegisters } from "./estimate.js";

const MIN_PRECISION = 4;
const MAX_PRECISION = 16;

function validatePrecision(precision: number): void {
  if (
    typeof precision !== "number" ||
    !Number.isInteger(precision) ||
    precision < MIN_PRECISION ||
    precision > MAX_PRECISION
  ) {
    throw new HllError(
      `precision must be an integer in [${MIN_PRECISION}, ${MAX_PRECISION}], got ${String(precision)}`,
    );
  }
}

/** Deterministic HyperLogLog sketch over FNV-1a hashed string keys. */
export class HyperLogLog {
  private readonly precision: number;
  private readonly registers: number[];
  private frozen = false;
  private adds = 0;

  constructor(precision: number) {
    validatePrecision(precision);
    this.precision = precision;
    this.registers = new Array(1 << precision).fill(0);
  }

  add(key: string): void {
    if (this.frozen) throw new HllError("cannot add to a frozen HyperLogLog");
    const { idx, rho } = rhoFromHash(fnv1a32(key), this.precision);
    if (rho > this.registers[idx]) this.registers[idx] = rho;
    this.adds++;
  }

  estimate(): number {
    return estimateFromRegisters(this.registers);
  }

  merge(other: HyperLogLog): void {
    if (this.frozen) throw new HllError("cannot merge into a frozen HyperLogLog");
    if (other.precision !== this.precision) {
      throw new HllError(
        `precision mismatch: cannot merge p=${other.precision} into p=${this.precision}`,
      );
    }
    for (let j = 0; j < this.registers.length; j++) {
      if (other.registers[j] > this.registers[j]) {
        this.registers[j] = other.registers[j];
      }
    }
  }

  exportRegisters(): number[] {
    return [...this.registers];
  }

  static fromRegisters(regs: number[]): HyperLogLog {
    if (!Array.isArray(regs)) {
      throw new HllError("registers must be an array");
    }
    const m = regs.length;
    const p = 31 - Math.clz32(m);
    if (
      m < (1 << MIN_PRECISION) ||
      m > (1 << MAX_PRECISION) ||
      (m & (m - 1)) !== 0
    ) {
      throw new HllError(`register array length must be a power of two in [16, 65536], got ${m}`);
    }
    const maxRho = 32 - p + 1;
    for (const value of regs) {
      if (!Number.isInteger(value) || value < 0 || value > maxRho) {
        throw new HllError(`register values must be integers in [0, ${maxRho}], got ${value}`);
      }
    }
    const sketch = new HyperLogLog(p);
    sketch.registers.splice(0, m, ...regs);
    return sketch;
  }

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  zeros(): number {
    let count = 0;
    for (const value of this.registers) {
      if (value === 0) count++;
    }
    return count;
  }

  stats(): HllStats {
    return {
      precision: this.precision,
      m: this.registers.length,
      zeros: this.zeros(),
      frozen: this.frozen,
      adds: this.adds,
    };
  }
}
