import { XorError } from "./errors.js";
import { fingerprint, hashIndex } from "./hash.js";
import { capacityFor, xorMergeTables } from "./table.js";
import type { XorStats } from "./types.js";

/** XOR-lite accum filter. */
export class XorFilter {
  private readonly seed: number;
  private readonly pending = new Set<string>();
  private table: Uint32Array = new Uint32Array(0);
  private m = 0;
  private builtSize = 0;
  private built = false;
  private frozen = false;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  add(key: string): void {
    if (this.frozen) throw new XorError("filter is frozen");
    if (this.built) throw new XorError("filter already built");
    this.pending.add(key);
  }

  build(): void {
    if (this.frozen) throw new XorError("filter is frozen");
    if (this.built) throw new XorError("filter already built");
    const n = this.pending.size;
    this.builtSize = n;
    if (n === 0) {
      this.m = 0;
      this.table = new Uint32Array(0);
    } else {
      this.m = capacityFor(n);
      this.table = new Uint32Array(this.m);
      for (const key of this.pending) {
        const fp = fingerprint(key, this.seed);
        this.table[hashIndex(key, 0, this.seed, this.m)]! ^= fp;
        this.table[hashIndex(key, 1, this.seed, this.m)]! ^= fp;
        this.table[hashIndex(key, 2, this.seed, this.m)]! ^= fp;
      }
    }
    this.pending.clear();
    this.built = true;
  }

  contains(key: string): boolean {
    if (!this.built) throw new XorError("filter not built");
    if (this.m === 0) return false;
    const fp = fingerprint(key, this.seed);
    const acc =
      (this.table[hashIndex(key, 0, this.seed, this.m)]! ^
        this.table[hashIndex(key, 1, this.seed, this.m)]! ^
        this.table[hashIndex(key, 2, this.seed, this.m)]!) >>>
      0;
    return acc === fp;
  }

  isBuilt(): boolean {
    return this.built;
  }

  size(): number {
    return this.builtSize;
  }

  merge(other: XorFilter): void {
    if (this.frozen) throw new XorError("filter is frozen");
    if (!this.built || !other.built) {
      throw new XorError("both filters must be built");
    }
    if (this.seed !== other.seed) throw new XorError("seed mismatch");
    if (this.m !== other.m) throw new XorError("capacity mismatch");
    this.table = xorMergeTables(this.table, other.table);
    this.builtSize += other.builtSize;
  }

  exportTable(): number[] {
    return Array.from(this.table);
  }

  static fromTable(
    seed: number,
    m: number,
    table: number[],
    size: number,
  ): XorFilter {
    if (table.length !== m) throw new XorError("table length mismatch");
    const xf = new XorFilter(seed);
    xf.m = m;
    xf.table = Uint32Array.from(table);
    xf.builtSize = size;
    xf.built = true;
    return xf;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): XorStats {
    return {
      seed: this.seed,
      m: this.m,
      size: this.builtSize,
      built: this.built,
      frozen: this.frozen,
    };
  }
}
