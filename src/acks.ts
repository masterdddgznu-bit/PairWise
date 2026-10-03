export class AckTable {
  ack(_replica: string, _index: number): void {}
  count(_index: number): number {
    return 0;
  }
  byIndex(_index: number): string[] {
    return [];
  }
  clearIndex(_index: number): void {}
  clearFrom(_index: number): void {}
}
