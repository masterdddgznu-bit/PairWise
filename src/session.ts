import type { Cluster } from "./cluster.js";

/** Client session — stub does not track context. */
export class Session {
  constructor(
    private readonly cluster: Cluster,
    private readonly preferredReplica: number = 0,
  ) {
    void this.cluster;
    void this.preferredReplica;
  }

  put(_key: string, _value: string, _replicaId?: number): void {
    /* stub */
  }

  get(_key: string, _replicaId?: number): string[] {
    return [];
  }
}
