import { VectorClock } from "./vector_clock.js";
import type { GetResult, Op, PutResult, VersionedValue } from "./types.js";

/**
 * Local KV replica backed by an append-only op-log.
 *
 * Every put (local or remote) becomes an op carrying the version vector of the
 * value. The current value of a key is the set of ops whose version vectors
 * are not dominated by another op for that key (the sibling set).
 */
export class Replica {
  readonly id: number;
  private readonly n: number;
  private readonly log: Op[] = [];
  private seenVV: VectorClock;

  constructor(id: number, replicaCount: number) {
    this.id = id;
    this.n = replicaCount;
    this.seenVV = new VectorClock(replicaCount);
  }

  /**
   * Write a value. `context` (e.g. a merged sibling context) is incorporated
   * causally, so the new version dominates every version the client observed.
   */
  put(key: string, value: string, context?: VectorClock): PutResult {
    let base = this.seenVV.clone();
    if (context) base = base.merge(context);
    const counter = base.get(this.id) + 1;
    const vv = base.increment(this.id);
    const op: Op = { key, value, vv, replicaId: this.id, counter };
    this.log.push(op);
    this.seenVV = this.seenVV.merge(vv);
    return { context: vv };
  }

  /**
   * Read a key. With `context`, values strictly dominated by the caller's
   * observed history are hidden (supports session monotonic reads / RYW).
   */
  get(key: string, context?: VectorClock): GetResult {
    const visible = this.siblings(key).filter((entry) => {
      if (!context) return true;
      return context.compare(entry.vv) !== 1;
    });
    let merged = new VectorClock(this.n);
    for (const entry of visible) merged = merged.merge(entry.vv);
    return {
      values: visible.map((entry) => entry.value),
      context: merged,
    };
  }

  /** Undominated (concurrent) versions of a key, in log (arrival) order. */
  siblings(key: string): VersionedValue[] {
    const entries = this.log.filter((op) => op.key === key);
    const maximal: Op[] = [];
    for (const op of entries) {
      if (maximal.some((other) => other.vv.compare(op.vv) === 1)) {
        continue;
      }
      for (let i = maximal.length - 1; i >= 0; i--) {
        if (op.vv.compare(maximal[i].vv) === 1) {
          maximal.splice(i, 1);
        }
      }
      maximal.push(op);
    }
    return maximal.map((op) => ({ value: op.value, vv: op.vv }));
  }

  storeVV(): VectorClock {
    return this.seenVV.clone();
  }

  /** Ops authored or received by this replica. */
  ops(): Op[] {
    return this.log.slice();
  }

  /** Ingest an op from another replica; already-covered ops are ignored. */
  applyRemote(op: Op): void {
    if (this.seenVV.coversOp(op.replicaId, op.counter)) return;
    this.log.push({ ...op, vv: op.vv.clone() });
    this.seenVV = this.seenVV.merge(op.vv);
  }
}
