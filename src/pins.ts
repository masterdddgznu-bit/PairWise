export class PinBook {
  pin(_pinId: string, _epoch: number, _deadline: number | null): void {}
  unpin(_pinId: string): boolean {
    return false;
  }
  epochOf(_pinId: string): number {
    return 0;
  }
  has(_pinId: string): boolean {
    return false;
  }
  ids(): string[] {
    return [];
  }
  epochs(): number[] {
    return [];
  }
  expired(_now: number): string[] {
    return [];
  }
}
