export class OwnerBook {
  constructor(_ownerIds: string[]) {}
  has(_id: string): boolean {
    return false;
  }
  fenceOf(_id: string): number {
    return 0;
  }
  bump(_id: string): number {
    return 0;
  }
  ids(): string[] {
    return [];
  }
}
