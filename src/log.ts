import type { ReplicLogOptions, ReplicLogSnapshot } from "./types.js";
import { Replica } from "./replica.js";
import { ReplicaHealth, catchUpReplica } from "./heal.js";
import { validateWriteQuorum } from "./quorum.js";
import { leaderAppend, recomputeCommitted } from "./leader.js";
import { truncateAfter as doTruncate } from "./truncate.js";
import { exportSnapshot, importSnapshot } from "./recover.js";
import { ReplicError } from "./errors.js";

export class ReplicLog {
  private replicas: Replica[];
  private health = new ReplicaHealth();
  private committedIndex = 0;

  constructor(private readonly opts: ReplicLogOptions) {
    validateWriteQuorum(opts.n, opts.w);
    this.replicas = Array.from({ length: opts.n }, (_, i) => new Replica(i));
  }

  append(payload: string): { index: number } {
    return leaderAppend(this, payload);
  }

  committed(): number {
    return this.committedIndex;
  }

  
  read(index: number): string | undefined {
    if (index < 1 || index > this.committedIndex) return undefined;
    return this.replicas[0]!.read(index);
  }

  failReplica(id: number): void {
    if (id < 0 || id >= this.opts.n) return;
    this.health.fail(id);
    this.committedIndex = recomputeCommitted(this);
  }

  
  healReplica(id: number): void {
    if (id < 0 || id >= this.opts.n) return;
    this.health.heal(id);
    catchUpReplica(this.replicas[id]!, this.replicas[0]!);
    this.committedIndex = recomputeCommitted(this);
  }

  replicaLastIndex(id: number): number {
    if (id < 0 || id >= this.opts.n) throw new ReplicError("bad replica id");
    return this.replicas[id]!.lastIndex();
  }

  truncateAfter(index: number): void {
    doTruncate(this, index);
  }

  exportState(): ReplicLogSnapshot {
    return exportSnapshot(this);
  }

  importState(state: ReplicLogSnapshot): void {
    importSnapshot(this, state);
  }

  getReplicas(): Replica[] {
    return this.replicas;
  }

  getHealth(): ReplicaHealth {
    return this.health;
  }

  getOpts(): ReplicLogOptions {
    return this.opts;
  }

  getCommitted(): number {
    return this.committedIndex;
  }

  setCommitted(v: number): void {
    this.committedIndex = v;
  }
}
