import { HllError } from "./errors.js";
import { fnv1a32 } from "./hash.js";
import { rhoFromHash } from "./rho.js";
import { estimateFromRegisters } from "./estimate.js";
import type { HllStats } from "./types.js";

const MIN_PRECISION = 4;
const MAX_PRECISION = 16;

function precisionFromLength(length: number): number {
  if (length <= 0 || (length & (length - 1)) !== 0) {
    throw new HllError(`register length ${length} is not a power of two`);
  }
  const p = Math.log2(length);
  if (!Number.isInteger(p) || p < MIN_PRECISION || p > MAX_PRECISION) {
    throw new HllError(`register length ${length} implies invalid precision`);
  }
  return p;
}

/** Deterministic HyperLogLog cardinality sketch over FNV-1a hashes. */
export class HyperLogLog {
  private readonly precision: number;
  private readonly registers: number[];
  private frozen = false;
  private adds = 0;

  constructor(precision: number) {
    if (
      !Number.isInteger(precision) ||
      precision < MIN_PRECISION ||
      precision > MAX_PRECISION
    ) {
      throw new HllError(`precision must be an integer in ${MIN_PRECISION}..${MAX_PRECISION}`);
    }
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
    if (this.precision !== other.precision) {
      throw new HllError("precision mismatch");
    }
    for (let i = 0; i < this.registers.length; i++) {
      if (other.registers[i] > this.registers[i]) {
        this.registers[i] = other.registers[i];
      }
    }
  }

  exportRegisters(): number[] {
    return [...this.registers];
  }

  static fromRegisters(regs: number[]): HyperLogLog {
    const p = precisionFromLength(regs.length);
    const hll = new HyperLogLog(p);
    for (let i = 0; i < regs.length; i++) hll.registers[i] = regs[i];
    return hll;
  }

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  zeros(): number {
    let count = 0;
    for (const v of this.registers) if (v === 0) count++;
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
