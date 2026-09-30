import { FilterError } from "./errors.js";
import { altBucket, fingerprintOf, primaryBucket } from "./fingerprint.js";
import { CuckooTable } from "./table.js";
import type { FilterOpts, FilterStats } from "./types.js";

export class CuckooFilter {
  private readonly bucketCount: number;
  private readonly bucketSize: number;
  private readonly fingerprintBits: number;
  private readonly maxKicks: number;
  private readonly table: CuckooTable;
  private readonly counters: FilterStats = {
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
    CuckooFilter.validate({
      bucketCount,
      bucketSize,
      fingerprintBits,
      maxKicks,
    });
    this.bucketCount = bucketCount;
    this.bucketSize = bucketSize;
    this.fingerprintBits = fingerprintBits;
    this.maxKicks = maxKicks;
    this.table = new CuckooTable(bucketCount, bucketSize);
  }

  private static validate(opts: FilterOpts): void {
    const { bucketCount, bucketSize, fingerprintBits, maxKicks } = opts;
    const isInt = (v: number) => Number.isInteger(v);
    if (
      !isInt(bucketCount) ||
      bucketCount < 2 ||
      (bucketCount & (bucketCount - 1)) !== 0
    ) {
      throw new FilterError(
        "bucketCount must be a power of two >= 2",
      );
    }
    if (!isInt(bucketSize) || bucketSize < 1) {
      throw new FilterError("bucketSize must be an integer >= 1");
    }
    if (!isInt(fingerprintBits) || fingerprintBits < 8 || fingerprintBits > 16) {
      throw new FilterError("fingerprintBits must be an integer in 8..16");
    }
    if (!isInt(maxKicks) || maxKicks < 1) {
      throw new FilterError("maxKicks must be an integer >= 1");
    }
  }

  private locations(key: string): { fp: number; i1: number; i2: number } {
    const fp = fingerprintOf(key, this.fingerprintBits);
    const i1 = primaryBucket(key, this.bucketCount);
    const i2 = altBucket(i1, fp, this.bucketCount);
    return { fp, i1, i2 };
  }

  insert(key: string): boolean {
    const { fp, i1, i2 } = this.locations(key);

    // Idempotent: an identical fingerprint in either bucket means present.
    if (this.table.bucketHas(i1, fp) || this.table.bucketHas(i2, fp)) {
      this.counters.inserts++;
      return true;
    }

    const s1 = this.table.emptySlot(i1);
    if (s1 !== -1) {
      this.table.put(i1, s1, fp);
      this.counters.inserts++;
      return true;
    }
    const s2 = this.table.emptySlot(i2);
    if (s2 !== -1) {
      this.table.put(i2, s2, fp);
      this.counters.inserts++;
      return true;
    }

    // Both buckets full: snapshot, then kick victims along alt paths.
    const snapshot = this.table.clone();
    let carried = fp;
    let bucket = i1;
    let attemptedKicks = 0;
    let success = false;

    for (let k = 0; k < this.maxKicks; k++) {
      attemptedKicks++;
      // Deterministic victim selection (no RNG/timer): first prefer a
      // victim whose alternate bucket has room, finishing in one hop.
      let slot = -1;
      for (let j = 0; j < this.bucketSize; j++) {
        const victimFp = this.table.get(bucket, j);
        const victimAlt = altBucket(
          bucket,
          victimFp,
          this.bucketCount,
        );
        if (this.table.emptySlot(victimAlt) !== -1) {
          slot = j;
          break;
        }
      }
      // Otherwise rotate slots across rounds so every edge is explored.
      if (slot === -1) slot = k % this.bucketSize;
      const victim = this.table.get(bucket, slot);
      this.table.set(bucket, slot, carried);
      carried = victim;
      bucket = altBucket(bucket, carried, this.bucketCount);

      const free = this.table.emptySlot(bucket);
      if (free !== -1) {
        this.table.put(bucket, free, carried);
        success = true;
        break;
      }
    }

    if (!success) {
      // Transactional rollback: the failed insert leaves no trace.
      this.table.restoreFrom(snapshot);
      this.counters.insertFails++;
      return false;
    }

    this.counters.kicks += attemptedKicks;
    this.counters.inserts++;
    return true;
  }

  lookup(key: string): boolean {
    const { fp, i1, i2 } = this.locations(key);
    return this.table.bucketHas(i1, fp) || this.table.bucketHas(i2, fp);
  }

  remove(key: string): boolean {
    const { fp, i1, i2 } = this.locations(key);
    if (this.table.bucketRemove(i1, fp) || this.table.bucketRemove(i2, fp)) {
      this.counters.deletes++;
      return true;
    }
    return false;
  }

  loadFactor(): number {
    return (
      this.table.occupied() / (this.bucketCount * this.bucketSize)
    );
  }

  size(): number {
    return this.table.occupied();
  }

  exportBuckets(): number[][] {
    return this.table.export();
  }

  stats(): FilterStats {
    return { ...this.counters };
  }

  static fromExport(buckets: number[][], opts: FilterOpts): CuckooFilter {
    CuckooFilter.validate(opts);
    const filter = new CuckooFilter(
      opts.bucketCount,
      opts.bucketSize,
      opts.fingerprintBits,
      opts.maxKicks,
    );
    const imported = CuckooTable.fromExport(
      buckets,
      opts.bucketCount,
      opts.bucketSize,
    );
    filter.table.restoreFrom(imported);
    return filter;
  }
}
