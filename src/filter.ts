import { FilterError } from "./errors.js";
import type { FilterOpts, FilterStats } from "./types.js";
import { fnv1a32 } from "./hash.js";
import { altBucket, fingerprintOf, primaryBucket } from "./fingerprint.js";
import { CuckooTable } from "./table.js";

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/** Deterministic cuckoo filter with transactional insert rollback. */
export class CuckooFilter {
  private readonly bucketCount: number;
  private readonly bucketSize: number;
  private readonly fingerprintBits: number;
  private readonly maxKicks: number;
  private table: CuckooTable;
  private readonly statsData: FilterStats = {
    inserts: 0,
    insertFails: 0,
    deletes: 0,
    kicks: 0,
  };

  constructor(
    bucketCount: number,
    bucketSize: number,
    fingerprintBits: number,
    maxKicks: number,
  ) {
    if (!isPowerOfTwo(bucketCount)) {
      throw new FilterError("bucketCount must be a power of two >= 2");
    }
    if (!Number.isInteger(bucketSize) || bucketSize < 1) {
      throw new FilterError("bucketSize must be an integer >= 1");
    }
    if (!Number.isInteger(fingerprintBits) || fingerprintBits < 8 || fingerprintBits > 16) {
      throw new FilterError("fingerprintBits must be an integer in 8..16");
    }
    if (!Number.isInteger(maxKicks) || maxKicks < 1) {
      throw new FilterError("maxKicks must be an integer >= 1");
    }
    this.bucketCount = bucketCount;
    this.bucketSize = bucketSize;
    this.fingerprintBits = fingerprintBits;
    this.maxKicks = maxKicks;
    this.table = new CuckooTable(bucketCount, bucketSize);
  }

  private candidates(key: string): { fp: number; i1: number; i2: number } {
    const fp = fingerprintOf(key, this.fingerprintBits);
    const i1 = primaryBucket(key, this.bucketCount);
    const i2 = altBucket(i1, fp, this.bucketCount);
    return { fp, i1, i2 };
  }

  insert(key: string): boolean {
    const { fp, i1, i2 } = this.candidates(key);

    if (this.table.contains(i1, fp) || this.table.contains(i2, fp)) {
      this.statsData.inserts++;
      return true;
    }

    const working = this.table.clone();

    const empty1 = working.firstEmpty(i1);
    if (empty1 !== -1) {
      working.put(i1, empty1, fp);
      this.table = working;
      this.statsData.inserts++;
      return true;
    }
    const empty2 = working.firstEmpty(i2);
    if (empty2 !== -1) {
      working.put(i2, empty2, fp);
      this.table = working;
      this.statsData.inserts++;
      return true;
    }

    let index = i1;
    let moving = fp;
    for (let kick = 0; kick < this.maxKicks; kick++) {
      const slot = fnv1a32(`${moving}:${kick}`) % this.bucketSize;
      moving = working.evict(index, slot, moving);
      index = altBucket(index, moving, this.bucketCount);
      const slotOut = working.firstEmpty(index);
      if (slotOut !== -1) {
        working.put(index, slotOut, moving);
        this.table = working;
        this.statsData.inserts++;
        this.statsData.kicks += kick + 1;
        return true;
      }
    }

    this.statsData.insertFails++;
    return false;
  }

  lookup(key: string): boolean {
    const { fp, i1, i2 } = this.candidates(key);
    return this.table.contains(i1, fp) || this.table.contains(i2, fp);
  }

  remove(key: string): boolean {
    const { fp, i1, i2 } = this.candidates(key);
    if (this.table.erase(i1, fp) || this.table.erase(i2, fp)) {
      this.statsData.deletes++;
      return true;
    }
    return false;
  }

  loadFactor(): number {
    return this.table.occupied() / (this.bucketCount * this.bucketSize);
  }

  size(): number {
    return this.table.occupied();
  }

  exportBuckets(): number[][] {
    return this.table.export();
  }

  stats(): FilterStats {
    return { ...this.statsData };
  }

  static fromExport(buckets: number[][], opts: FilterOpts): CuckooFilter {
    const filter = new CuckooFilter(
      opts.bucketCount,
      opts.bucketSize,
      opts.fingerprintBits,
      opts.maxKicks,
    );
    filter.table = CuckooTable.fromExport(
      buckets,
      opts.bucketCount,
      opts.bucketSize,
    );
    return filter;
  }
}
