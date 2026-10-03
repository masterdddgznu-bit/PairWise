import { hash32 } from "./hash.js";
import {
  DuplicateNodeError, EmptyRingError, InvalidConfigError, InvalidIdError,
} from "./errors.js";
import { MigrateTable } from "./migrate.js";
import { RingState } from "./ring.js";
import type { LocateResult, MigRingOptions, Point } from "./types.js";

export class MigRing {
  private readonly ringSize: number;
  private readonly ring: RingState;
  private readonly mig = new MigrateTable();

  constructor(opts: MigRingOptions) {
    if (!Number.isInteger(opts.ringSize) || opts.ringSize < 4) throw new InvalidConfigError("ringSize");
    this.ringSize = opts.ringSize;
    this.ring = new RingState(opts.ringSize);
  }

  addNode(id: string, weight = 1): void {
    if (!id) throw new InvalidIdError("empty id");
    if (!Number.isInteger(weight) || weight < 1) throw new InvalidConfigError("weight");
    if (this.ring.nodeWeights.has(id)) throw new DuplicateNodeError(id);
    this.ring.nodeWeights.set(id, weight);
    this.ring.points.addNodePoints(id, weight);
  }

  removeNode(id: string): void {
    if (!this.ring.nodeWeights.has(id)) throw new InvalidIdError(id);
    this.ring.nodeWeights.delete(id);
    this.ring.points.removeNode(id);
    this.mig.dropStickyForNode(id);
  }

  locate(key: string): LocateResult {
    const sticky = this.mig.stickyOwner(key);
    const moving = this.mig.movingTo(key);
    if (sticky) {
      const o: LocateResult = { owner: sticky };
      if (moving) o.migratingTo = moving;
      return o;
    }
    const from = this.mig.movingFrom(key);
    if (from) return { owner: from, migratingTo: moving };
    const owner = this.ring.points.ownerOf(hash32(key) % this.ringSize);
    if (!owner) throw new EmptyRingError();
    return { owner };
  }

  beginMove(key: string, toNode: string): void {
    if (!this.ring.nodeWeights.has(toNode)) throw new InvalidIdError(toNode);
    this.mig.begin(key, toNode, this.locate(key).owner);
  }
  commitMove(key: string): void { this.mig.commit(key); }
  abortMove(key: string): void { this.mig.abort(key); }

  nodes(): string[] { return [...this.ring.nodeWeights.keys()].sort(); }
  points(): Point[] { return this.ring.points.all(); }

  exportState(): object {
    return { ringSize: this.ringSize, weights: Object.fromEntries(this.ring.nodeWeights), migrate: this.mig.exportState() };
  }

  importState(state: object): void {
    const s = state as { ringSize: number; weights: Record<string, number>; migrate: unknown };
    if (s.ringSize !== this.ringSize) throw new InvalidConfigError("ringSize mismatch");
    for (const id of [...this.ring.nodeWeights.keys()]) this.ring.points.removeNode(id);
    this.ring.nodeWeights.clear();
    this.ring.points.clear();
    for (const id of Object.keys(s.weights).sort()) {
      this.ring.nodeWeights.set(id, s.weights[id]!);
      this.ring.points.addNodePoints(id, s.weights[id]!);
    }
    this.mig.importState(s.migrate);
  }
}
export { hash32 };
