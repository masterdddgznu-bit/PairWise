import { VectorClock } from "./vector_clock.js";
import { InvalidOperationError } from "./errors.js";
import type { GetResult, Op, PutResult, VersionedValue } from "./types.js";

/** Local store + op-log. */
export class Replica {
  readonly id: number;
  private readonly n: number;
  private readonly log: Op[] = [];
  private readonly seenOps = new Set<string>();
  private readonly store = new Map<string, VersionedValue[]>();
  private versionVector: VectorClock;

  constructor(id: number, replicaCount: number) {
    if (!Number.isInteger(id) || id < 0 || id >= replicaCount) {
      throw new InvalidOperationError(`invalid replica id: ${id}`);
    }
    if (!Number.isInteger(replicaCount) || replicaCount <= 0) {
      throw new InvalidOperationError(`invalid replica count: ${replicaCount}`);
    }
    this.id = id;
    this.n = replicaCount;
    this.versionVector = new VectorClock(replicaCount);
  }

  put(key: string, value: string, context?: VectorClock): PutResult {
    if (context !== undefined) this.requireCompatibleClock(context);

    const base = (context ?? new VectorClock(this.n)).merge(this.versionVector);
    const vv = base.increment(this.id);
    const op: Op = { key, value, vv, replicaId: this.id, counter: vv.get(this.id) };

    this.applyLocal(op);
    return { context: vv };
  }

  get(key: string, context?: VectorClock): GetResult {
    if (context !== undefined) this.requireCompatibleClock(context);

    const versions = this.store.get(key) ?? [];
    const merged = versions.reduce(
      (clock, version) => clock.merge(version.vv),
      new VectorClock(this.n),
    );
    const resultContext = context === undefined ? merged : merged.merge(context);
    const visible = versions.filter(
      version => context?.dominates(version.vv) !== true,
    );

    return {
      values: visible.map(version => version.value),
      context: resultContext,
    };
  }

  storeVV(): VectorClock {
    return this.versionVector.clone();
  }

  /** Ops authored or received by this replica. */
  ops(): Op[] {
    return this.log.map(op => ({ ...op, vv: op.vv.clone() }));
  }

  hasOp(replicaId: number, counter: number): boolean {
    return this.seenOps.has(this.opKey(replicaId, counter));
  }

  applyRemote(op: Op): void {
    this.validateOp(op);
    if (this.hasOp(op.replicaId, op.counter)) return;

    const versions = this.store.get(op.key) ?? [];
    const candidate = op.vv;
    if (
      versions.some(version => {
        const order = version.vv.compare(candidate);
        return order === 0 || order === 1;
      })
    ) {
      return;
    }

    const nextVersions = versions
      .filter(version => !candidate.dominates(version.vv))
      .concat({ value: op.value, vv: candidate.clone() });
    this.store.set(op.key, nextVersions);
    this.log.push({ ...op, vv: candidate.clone() });
    this.seenOps.add(this.opKey(op.replicaId, op.counter));
    this.versionVector = this.versionVector.merge(candidate);
  }

  private applyLocal(op: Op): void {
    const versions = this.store.get(op.key) ?? [];
    const nextVersions = versions
      .filter(version => !op.vv.dominates(version.vv))
      .concat({ value: op.value, vv: op.vv.clone() });

    this.store.set(op.key, nextVersions);
    this.log.push({ ...op, vv: op.vv.clone() });
    this.seenOps.add(this.opKey(op.replicaId, op.counter));
    this.versionVector = this.versionVector.merge(op.vv);
  }

  private validateOp(op: Op): void {
    this.requireCompatibleClock(op.vv);
    if (
      !Number.isInteger(op.replicaId) ||
      op.replicaId < 0 ||
      op.replicaId >= this.n ||
      !Number.isInteger(op.counter) ||
      op.counter <= 0 ||
      op.vv.get(op.replicaId) !== op.counter
    ) {
      throw new InvalidOperationError("invalid causal operation");
    }
  }

  private requireCompatibleClock(clock: VectorClock): void {
    if (clock.size() !== this.n) {
      throw new InvalidOperationError(
        `vector clock size mismatch: expected ${this.n}, got ${clock.size()}`,
      );
    }
  }

  private opKey(replicaId: number, counter: number): string {
    return `${replicaId}:${counter}`;
  }
}
