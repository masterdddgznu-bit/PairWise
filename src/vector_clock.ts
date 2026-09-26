/**
 * Immutable vector clock over a fixed set of numbered replicas.
 *
 * Components are dense indices `[0, n)`. All mutating helpers return new
 * instances so clocks may be shared freely (e.g. embedded in ops).
 */
export class VectorClock {
  private readonly vec: number[];

  constructor(n: number) {
    this.vec = new Array<number>(n).fill(0);
  }

  static from(record: Record<string, number> | number[]): VectorClock {
    if (Array.isArray(record)) {
      const clock = new VectorClock(record.length);
      record.forEach((value, i) => {
        clock.vec[i] = value;
      });
      return clock;
    }
    let n = 0;
    for (const key of Object.keys(record)) n = Math.max(n, Number(key) + 1);
    const clock = new VectorClock(n);
    for (const [key, value] of Object.entries(record)) {
      clock.vec[Number(key)] = value;
    }
    return clock;
  }

  increment(replicaId: number): VectorClock {
    const next = this.clone();
    next.vec[replicaId] = (next.vec[replicaId] ?? 0) + 1;
    return next;
  }

  /** Pointwise maximum, growing the result to fit the larger coordinate space. */
  merge(other: VectorClock): VectorClock {
    const next = new VectorClock(Math.max(this.vec.length, other.vec.length));
    for (let i = 0; i < next.vec.length; i++) {
      next.vec[i] = Math.max(this.vec[i] ?? 0, other.vec[i] ?? 0);
    }
    return next;
  }

  /** -1 if this < other, 1 if this > other, 0 if equal, undefined if concurrent */
  compare(other: VectorClock): -1 | 0 | 1 | undefined {
    let hasLess = false;
    let hasGreater = false;
    const len = Math.max(this.vec.length, other.vec.length);
    for (let i = 0; i < len; i++) {
      const a = this.vec[i] ?? 0;
      const b = other.vec[i] ?? 0;
      if (a < b) hasLess = true;
      else if (a > b) hasGreater = true;
    }
    if (!hasLess && !hasGreater) return 0;
    if (hasLess && hasGreater) return undefined;
    return hasLess ? -1 : 1;
  }

  toRecord(): Record<string, number> {
    const record: Record<string, number> = {};
    for (let i = 0; i < this.vec.length; i++) {
      record[String(i)] = this.vec[i];
    }
    return record;
  }

  size(): number {
    return this.vec.length;
  }

  get(replicaId: number): number {
    return this.vec[replicaId] ?? 0;
  }

  /** `this >= other` component-wise (equal clocks dominate each other). */
  dominates(other: VectorClock): boolean {
    const len = Math.max(this.vec.length, other.vec.length);
    for (let i = 0; i < len; i++) {
      if ((this.vec[i] ?? 0) < (other.vec[i] ?? 0)) return false;
    }
    return true;
  }

  concurrentWith(other: VectorClock): boolean {
    return this.compare(other) === undefined;
  }

  coversOp(replicaId: number, counter: number): boolean {
    return this.get(replicaId) >= counter;
  }

  clone(): VectorClock {
    const next = new VectorClock(this.vec.length);
    for (let i = 0; i < this.vec.length; i++) {
      next.vec[i] = this.vec[i];
    }
    return next;
  }
}
