export class ReplicaSet {
  constructor(_replicas: string[]) {}
  has(_id: string): boolean {
    return false;
  }
  sorted(): string[] {
    return [];
  }
  primaryOf(_view: number): string {
    return "";
  }
  size(): number {
    return 0;
  }
}
