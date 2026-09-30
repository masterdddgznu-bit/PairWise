import { FilterError } from "./errors.js";

/** Fixed-capacity bucket table; 0 marks an empty slot. */
export class CuckooTable {
  private rows: number[][];
  private used: number;

  constructor(readonly bucketCount: number, readonly bucketSize: number) {
    this.rows = [];
    for (let i = 0; i < bucketCount; i++) {
      this.rows.push(new Array<number>(bucketSize).fill(0));
    }
    this.used = 0;
  }

  private row(index: number): number[] {
    return this.rows[index];
  }

  firstEmpty(index: number): number {
    const row = this.row(index);
    for (let slot = 0; slot < row.length; slot++) {
      if (row[slot] === 0) return slot;
    }
    return -1;
  }

  contains(index: number, fp: number): boolean {
    return this.row(index).includes(fp);
  }

  put(index: number, slot: number, fp: number): void {
    if (this.rows[index][slot] === 0 && fp !== 0) this.used++;
    this.rows[index][slot] = fp;
  }

  /** Remove one matching fingerprint; returns whether one was erased. */
  erase(index: number, fp: number): boolean {
    const row = this.row(index);
    const slot = row.indexOf(fp);
    if (slot === -1) return false;
    row[slot] = 0;
    this.used--;
    return true;
  }

  isFull(index: number): boolean {
    return this.firstEmpty(index) === -1;
  }

  /** Replace the fingerprint in a full bucket, returning the displaced one. */
  evict(index: number, slot: number, fp: number): number {
    const row = this.row(index);
    const victim = row[slot];
    row[slot] = fp;
    return victim;
  }

  get(index: number, slot: number): number {
    return this.rows[index][slot];
  }

  clone(): CuckooTable {
    const copy = new CuckooTable(this.bucketCount, this.bucketSize);
    copy.rows = this.rows.map((row) => row.slice());
    copy.used = this.used;
    return copy;
  }

  occupied(): number {
    return this.used;
  }

  /** Deep copy as plain arrays; 0 denotes an empty slot. */
  export(): number[][] {
    return this.rows.map((row) => row.slice());
  }

  static fromExport(buckets: number[][], bucketCount: number, bucketSize: number): CuckooTable {
    if (!Array.isArray(buckets) || buckets.length !== bucketCount) {
      throw new FilterError("fromExport: bucket count mismatch");
    }
    const table = new CuckooTable(bucketCount, bucketSize);
    for (let i = 0; i < bucketCount; i++) {
      const row = buckets[i];
      if (!Array.isArray(row) || row.length !== bucketSize) {
        throw new FilterError("fromExport: bucket size mismatch");
      }
      for (let slot = 0; slot < bucketSize; slot++) {
        const fp = row[slot];
        if (!Number.isInteger(fp) || fp < 0 || fp > 0xffff) {
          throw new FilterError("fromExport: invalid fingerprint value");
        }
        table.rows[i][slot] = fp;
        if (fp !== 0) table.used++;
      }
    }
    return table;
  }
}
