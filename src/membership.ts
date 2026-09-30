/** Member epoch registry — starter stub. */
export class MemberRegistry {
  constructor(_members: string[]) {}

  sortedMembers(): string[] {
    throw new Error("sortedMembers not implemented");
  }

  epochOf(_nodeId: string): number {
    throw new Error("epochOf not implemented");
  }

  minEpoch(): number {
    throw new Error("minEpoch not implemented");
  }

  allAtLeast(_epoch: number): boolean {
    throw new Error("allAtLeast not implemented");
  }

  advance(_nodeId: string): number {
    throw new Error("advance not implemented");
  }

  propose(_nodeId: string, _nextEpoch: number): void {
    throw new Error("propose not implemented");
  }

  ack(_nodeId: string, _epoch: number): void {
    throw new Error("ack not implemented");
  }

  join(_nodeId: string, _atEpoch: number): void {
    throw new Error("join not implemented");
  }

  leave(_nodeId: string): void {
    throw new Error("leave not implemented");
  }

  has(_nodeId: string): boolean {
    throw new Error("has not implemented");
  }
}
