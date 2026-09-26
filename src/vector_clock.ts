/** Immutable vector clock. */
export class VectorClock {
  private readonly counters: number[];

  constructor(sizeOrCounters: number | number[] = 0) {
    this.counters =
      typeof sizeOrCounters === "number"
        ? new Array(sizeOrCounters).fill(0)
        : [...sizeOrCounters];
  }

  private static requireSameSize(left: VectorClock, right: VectorClock): void {
    if (left.size() !== right.size()) {
      throw new Error(
        `vector clock size mismatch: ${left.size()} !== ${right.size()}`,
      );
    }
  }

  static from(_record: Record<string, number> | number[]): VectorClock {
    if (Array.isArray(_record)) {
      return new VectorClock(_record);
    }

    const entries = Object.entries(_record)
      .filter(([id]) => /^\d+$/u.test(id))
      .map(([id, value]) => [Number(id), value] as const);
    const size = entries.reduce((max, [id]) => Math.max(max, id + 1), 0);
    const counters = new Array(size).fill(0);
    for (const [id, value] of entries) {
      counters[id] = value;
    }
    return new VectorClock(counters);
  }

  increment(_replicaId: number): VectorClock {
    const counters = [...this.counters];
    counters[_replicaId] += 1;
    return new VectorClock(counters);
  }

  merge(_other: VectorClock): VectorClock {
    VectorClock.requireSameSize(this, _other);
    return new VectorClock(
      this.counters.map((value, id) => Math.max(value, _other.counters[id])),
    );
  }

  /** -1 if this < other, 1 if this > other, 0 if equal, undefined if concurrent */
  compare(_other: VectorClock): -1 | 0 | 1 | undefined {
    VectorClock.requireSameSize(this, _other);

    let hasSmaller = false;
    let hasGreater = false;
    for (let id = 0; id < this.counters.length; id += 1) {
      hasSmaller ||= this.counters[id] < _other.counters[id];
      hasGreater ||= this.counters[id] > _other.counters[id];
    }

    if (!hasSmaller && !hasGreater) return 0;
    if (!hasSmaller) return 1;
    if (!hasGreater) return -1;
    return undefined;
  }

  toRecord(): Record<string, number> {
    return Object.fromEntries(this.counters.map((value, id) => [String(id), value]));
  }

  size(): number {
    return this.counters.length;
  }

  get(_replicaId: number): number {
    return this.counters[_replicaId] ?? 0;
  }

  dominates(_other: VectorClock): boolean {
    return this.compare(_other) === 1;
  }

  concurrentWith(_other: VectorClock): boolean {
    return this.compare(_other) === undefined;
  }

  coversOp(_replicaId: number, _counter: number): boolean {
    return this.get(_replicaId) >= _counter;
  }

  clone(): VectorClock {
    return new VectorClock(this.counters);
  }
}
