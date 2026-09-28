export class StableGc {
  ack(_to: number, _clock: number[]): void {
    throw new Error("gc ack not implemented");
  }

  minStable(_n: number): number[] {
    throw new Error("minStable not implemented");
  }

  collect(_n: number): void {
    throw new Error("gc collect not implemented");
  }
}
