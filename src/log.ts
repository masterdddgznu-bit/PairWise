import type { ReplicLogOptions, ReplicLogSnapshot } from "./types.js";
import { Replica } from "./replica.js";
import { ReplicaHealth } from "./heal.js";
import { validateWriteQuorum } from "./quorum.js";
import { leaderAppend } from "./leader.js";
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

  /** BUG: ignores committed bound — reads any present entry on leader. */
  read(index: number): string | undefined {
    if (index < 1) return undefined;
    return this.replicas[0]!.read(index);
  }

  failReplica(id: number): void {
    if (id < 0 || id >= this.opts.n) return;
    this.health.fail(id);
  }

  /** BUG: heal does not catch up lagging follower from leader. */
  healReplica(id: number): void {
    if (id < 0 || id >= this.opts.n) return;
    this.health.heal(id);
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
