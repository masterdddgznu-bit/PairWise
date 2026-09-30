/** Cuckoo bucket table — starter stub. */
export class CuckooTable {
  constructor(_bucketCount: number, _bucketSize: number) {
    throw new Error("CuckooTable not implemented");
  }

  clone(): CuckooTable {
    throw new Error("CuckooTable clone not implemented");
  }

  occupied(): number {
    throw new Error("CuckooTable occupied not implemented");
  }

  export(): number[][] {
    throw new Error("CuckooTable export not implemented");
  }

  static fromExport(_buckets: number[][], _bucketCount: number, _bucketSize: number): CuckooTable {
    throw new Error("CuckooTable fromExport not implemented");
  }
}
