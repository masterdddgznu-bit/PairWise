import { Partition } from "./partition.js";

/** Multi-partition topic — stub ignores routing. */
export class Topic {
  private partitions: Partition[] = [];

  constructor(partitionCount: number) {
    this.partitions = Array.from({ length: partitionCount }, () => new Partition());
  }

  partitionCount(): number {
    return this.partitions.length;
  }

  produce(_value: string, _key?: string | null): { partition: number; offset: number } {
    return { partition: 0, offset: 0 };
  }

  getPartition(index: number): Partition {
    return this.partitions[index];
  }
}
