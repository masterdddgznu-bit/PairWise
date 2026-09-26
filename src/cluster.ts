import { VirtualClock } from "./clock.js";
import { Replica } from "./replica.js";
import { syncAllPairs } from "./anti_entropy.js";
import { InvalidClusterError, InvalidReplicaError } from "./errors.js";

export class Cluster {
  private readonly replicas: Replica[];
  readonly clock: VirtualClock;

  constructor(opts: { replicaCount?: number; clock?: VirtualClock } = {}) {
    const replicaCount = opts.replicaCount ?? 3;
    if (!Number.isInteger(replicaCount) || replicaCount <= 0) {
      throw new InvalidClusterError(`invalid replica count: ${replicaCount}`);
    }
    this.clock = opts.clock ?? new VirtualClock();
    this.replicas = Array.from(
      { length: replicaCount },
      (_, id) => new Replica(id, replicaCount),
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
