/** Vector clock — stub returns dummy values. */
export class VectorClock {
  constructor(private readonly n: number) {}

  static from(_record: Record<string, number> | number[]): VectorClock {
    return new VectorClock(0);
  }

  increment(_replicaId: number): VectorClock {
    return this;
  }

  merge(_other: VectorClock): VectorClock {
    return this;
  }

  /** -1 if this < other, 1 if this > other, 0 if equal, undefined if concurrent */
  compare(_other: VectorClock): -1 | 0 | 1 | undefined {
    return 0;
  }

  toRecord(): Record<string, number> {
    return {};
  }

  size(): number {
    return this.n;
  }

  get(_replicaId: number): number {
    return 0;
  }

  dominates(_other: VectorClock): boolean {
    return false;
  }

  concurrentWith(_other: VectorClock): boolean {
    return false;
  }

  coversOp(_replicaId: number, _counter: number): boolean {
    return false;
  }

  clone(): VectorClock {
    return new VectorClock(this.n);
  }
}
