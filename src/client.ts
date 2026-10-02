import type { QuorumKVOptions, QuorumSnapshot, KVEntry } from "./types.js";
import { Replica } from "./replica.js";
import { ReplicaHealth } from "./heal.js";
import { validateQuorum } from "./quorum.js";
import { routeGet, routePut } from "./router.js";
import { exportSnapshot, importSnapshot } from "./recover.js";
import { QuorumError } from "./errors.js";

export class QuorumKV {
  private replicas: Replica[];
  private health = new ReplicaHealth();

  constructor(private readonly opts: QuorumKVOptions) {
    validateQuorum(opts.n, opts.r, opts.w);
    this.replicas = Array.from({ length: opts.n }, (_, i) => new Replica(i));
  }

  put(key: string, value: string, expectedVersion?: number): { version: number } {
    return routePut(this, key, value, expectedVersion);
  }

  get(key: string): { value: string; version: number } | undefined {
    return routeGet(this, key);
  }

  failReplica(id: number): void {
    if (id < 0 || id >= this.opts.n) return;
    this.health.fail(id);
  }

  healReplica(id: number): void {
    if (id < 0 || id >= this.opts.n) return;
    this.health.heal(id);
  }

  replicaGet(id: number, key: string): KVEntry | undefined {
    if (id < 0 || id >= this.opts.n) throw new QuorumError("bad replica id");
    return this.replicas[id]!.get(key);
  }

  exportState(): QuorumSnapshot {
    return exportSnapshot(this);
  }

  importState(state: QuorumSnapshot): void {
    importSnapshot(this, state);
  }

  getReplicas(): Replica[] {
    return this.replicas;
  }

  getHealth(): ReplicaHealth {
    return this.health;
  }

  getOpts(): QuorumKVOptions {
    return this.opts;
  }
}
