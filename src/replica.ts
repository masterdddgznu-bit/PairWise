import { VectorClock } from "./vector_clock.js";
import type { GetResult, Op, PutResult } from "./types.js";

/** Local store + op-log — stub does not persist. */
export class Replica {
  readonly id: number;
  private readonly n: number;

  constructor(id: number, replicaCount: number) {
    this.id = id;
    this.n = replicaCount;
  }

  put(_key: string, _value: string, _context?: VectorClock): PutResult {
    return { context: new VectorClock(this.n) };
  }

  get(_key: string, _context?: VectorClock): GetResult {
    return { values: [], context: new VectorClock(this.n) };
  }

  storeVV(): VectorClock {
    return new VectorClock(this.n);
  }

  /** Ops authored or received by this replica. */
  ops(): Op[] {
    return [];
  }

  applyRemote(_op: Op): void {
    /* stub */
  }
}
