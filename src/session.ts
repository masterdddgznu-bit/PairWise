import type { Cluster } from "./cluster.js";
import { VectorClock } from "./vector_clock.js";

/** Client session with per-key read-your-writes and monotonic reads. */
export class Session {
  private readonly contexts = new Map<string, VectorClock>();

  constructor(
    private readonly cluster: Cluster,
    private readonly preferredReplica: number = 0,
  ) {
  }

  put(key: string, value: string, replicaId: number = this.preferredReplica): void {
    const result = this.cluster
      .replica(replicaId)
      .put(key, value, this.contexts.get(key));
    this.observe(key, result.context);
  }

  get(key: string, replicaId: number = this.preferredReplica): string[] {
    const result = this.cluster
      .replica(replicaId)
      .get(key, this.contexts.get(key));
    this.observe(key, result.context);
    return result.values;
  }

  private observe(key: string, clock: VectorClock): void {
    const current = this.contexts.get(key);
    this.contexts.set(
      key,
      current === undefined ? clock.clone() : current.merge(clock),
    );
  }
}
