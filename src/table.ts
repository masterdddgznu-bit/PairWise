/** Flat bucket table: slot 0 denotes an empty cell. */
export class CuckooTable {
  readonly bucketCount: number;
  readonly bucketSize: number;
  private readonly slots: Uint16Array;
  private used: number;

  constructor(bucketCount: number, bucketSize: number) {
    this.bucketCount = bucketCount;
    this.bucketSize = bucketSize;
    this.slots = new Uint16Array(bucketCount * bucketSize);
    this.used = 0;
  }

  /** Index of the first empty slot in a bucket, or -1 when full. */
  emptySlot(bucket: number): number {
    const base = bucket * this.bucketSize;
    for (let j = 0; j < this.bucketSize; j++) {
      if (this.slots[base + j] === 0) return j;
    }
    return -1;
  }

  /** Whether a fingerprint is present in a bucket. */
  bucketHas(bucket: number, fp: number): boolean {
    const base = bucket * this.bucketSize;
    for (let j = 0; j < this.bucketSize; j++) {
      if (this.slots[base + j] === fp) return true;
    }
    return false;
  }

  /** Remove one matching fingerprint; returns whether one was removed. */
  bucketRemove(bucket: number, fp: number): boolean {
    const base = bucket * this.bucketSize;
    for (let j = 0; j < this.bucketSize; j++) {
      if (this.slots[base + j] === fp) {
        this.slots[base + j] = 0;
        this.used--;
        return true;
      }
    }
    return false;
  }

  get(bucket: number, slot: number): number {
    return this.slots[bucket * this.bucketSize + slot];
  }

  /** Place into an empty slot. */
  put(bucket: number, slot: number, fp: number): void {
    this.slots[bucket * this.bucketSize + slot] = fp;
    this.used++;
  }

  /** Overwrite a slot without changing occupancy (used during kicks). */
  set(bucket: number, slot: number, fp: number): void {
    this.slots[bucket * this.bucketSize + slot] = fp;
  }

  occupied(): number {
    return this.used;
  }

  clone(): CuckooTable {
    const copy = new CuckooTable(this.bucketCount, this.bucketSize);
    copy.slots.set(this.slots);
    copy.used = this.used;
    return copy;
  }

 /** Restore all cells from another table of the same shape. */
  restoreFrom(other: CuckooTable): void {
    this.slots.set(other.slots);
    this.used = other.used;
  }

  export(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.bucketCount; i++) {
      const row: number[] = [];
      const base = i * this.bucketSize;
      for (let j = 0; j < this.bucketSize; j++) {
        row.push(this.slots[base + j]);
      }
      out.push(row);
    }
    return out;
  }

  static fromExport(
    buckets: number[][],
    bucketCount: number,
    bucketSize: number,
  ): CuckooTable {
    if (!Array.isArray(buckets) || buckets.length !== bucketCount) {
      throw new Error("exported buckets must have bucketCount rows");
    }
    const table = new CuckooTable(bucketCount, bucketSize);
    for (let i = 0; i < bucketCount; i++) {
      const row = buckets[i];
      if (!Array.isArray(row) || row.length !== bucketSize) {
        throw new Error("each exported bucket must have bucketSize slots");
      }
      for (let j = 0; j < bucketSize; j++) {
        const v = row[j];
        if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
          throw new Error("exported fingerprints must be uint16 values");
        }
        if (v !== 0) {
          table.slots[i * bucketSize + j] = v;
          table.used++;
        }
      }
    }
    return table;
  }
}
