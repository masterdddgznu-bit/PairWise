import { Partition } from "./partition.js";

function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Multi-partition topic: key-hash routing or round-robin when keyless. */
export class Topic {
  private partitions: Partition[] = [];
  private roundRobin = 0;

  constructor(partitionCount: number) {
    if (!Number.isInteger(partitionCount) || partitionCount <= 0) {
      throw new Error("partitionCount must be a positive integer");
    }
    this.partitions = Array.from({ length: partitionCount }, () => new Partition());
  }

  partitionCount(): number {
    return this.partitions.length;
  }

  produce(value: string, key?: string | null): { partition: number; offset: number } {
    const index =
      key === null || key === undefined
        ? this.roundRobin++ % this.partitions.length
        : hashKey(key) % this.partitions.length;
    const offset = this.partitions[index].append(key ?? null, value);
    return { partition: index, offset };
  }

  getPartition(index: number): Partition {
    return this.partitions[index];
  }
}
