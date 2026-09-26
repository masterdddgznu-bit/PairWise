import { VirtualClock } from "./clock.js";
import { Replica } from "./replica.js";
import { syncAllPairs } from "./anti_entropy.js";
import { InvalidReplicaError } from "./errors.js";

export class Cluster {
  private readonly replicas: Replica[];
  readonly clock: VirtualClock;

  constructor(opts: { replicaCount: number; clock?: VirtualClock }) {
    this.clock = opts.clock ?? new VirtualClock();
    this.replicas = Array.from(
      { length: opts.replicaCount },
      (_, id) => new Replica(id, opts.replicaCount),
    );
  }

  replica(id: number): Replica {
    const r = this.replicas[id];
    if (!r) throw new InvalidReplicaError(id);
    return r;
  }

  replicaCount(): number {
    return this.replicas.length;
  }

  /** Pairwise anti-entropy over all ordered pairs. */
  syncAll(): void {
    syncAllPairs(this.replicas);
  }
}
