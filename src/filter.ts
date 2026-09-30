import { FilterError } from "./errors.js";
import type { FilterOpts, FilterStats } from "./types.js";

/** Cuckoo filter — starter stub. */
export class CuckooFilter {
  constructor(
    _bucketCount: number,
    _bucketSize: number,
    _fingerprintBits: number,
    _maxKicks: number,
  ) {
    /* params accepted; methods throw until implemented */
  }

  insert(_key: string): boolean {
    throw new FilterError("insert not implemented");
  }

  lookup(_key: string): boolean {
    throw new FilterError("lookup not implemented");
  }

  remove(_key: string): boolean {
    throw new FilterError("remove not implemented");
  }

  loadFactor(): number {
    throw new FilterError("loadFactor not implemented");
  }

  size(): number {
    throw new FilterError("size not implemented");
  }

  exportBuckets(): number[][] {
    throw new FilterError("exportBuckets not implemented");
  }

  stats(): FilterStats {
    throw new FilterError("stats not implemented");
  }

  static fromExport(_buckets: number[][], _opts: FilterOpts): CuckooFilter {
    throw new FilterError("fromExport not implemented");
  }
}
