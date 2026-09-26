import { VectorClock } from "./vector_clock.js";
import type { Cluster } from "./cluster.js";
import type { VersionedValue } from "./types.js";

/**
 * Client session providing:
 *  - read-your-writes: a put is immediately visible on every replica the
 *    session reads from, even before anti-entropy propagates the op;
 *  - monotonic reads: the session keeps the merge of every version it has
 *    observed, so reads never move backwards to dominated versions.
 */
export class Session {
  private context: VectorClock;
  private readonly pending = new Map<string, VersionedValue[]>();

  constructor(
    private readonly cluster: Cluster,
    private readonly preferredReplica: number = 0,
  ) {
    this.context = new VectorClock(cluster.replicaCount());
  }

  put(key: string, value: string, replicaId: number = this.preferredReplica): void {
    const { context } = this.cluster.replica(replicaId).put(key, value, this.context);
    this.context = this.context.merge(context);
    const writes = this.pending.get(key) ?? [];
    const live = writes.filter((entry) => context.compare(entry.vv) !== 1);
    live.push({ value, vv: context });
    this.pending.set(key, live);
  }

  get(key: string, replicaId: number = this.preferredReplica): string[] {
    const target = this.cluster.replica(replicaId);
    const visible = target.siblings(key).filter((entry) => {
      const cmp = this.context.compare(entry.vv);
      return cmp !== 1;
    });
    for (const entry of this.pending.get(key) ?? []) {
      if (
        !visible.some(
          (other) => other.value === entry.value && other.vv.compare(entry.vv) === 0,
        )
      ) {
        visible.push(entry);
      }
    }
    const maximal: VersionedValue[] = [];
    for (const entry of visible) {
      if (maximal.some((other) => other.vv.compare(entry.vv) === 1)) continue;
      for (let i = maximal.length - 1; i >= 0; i--) {
        if (entry.vv.compare(maximal[i].vv) === 1) maximal.splice(i, 1);
      }
      maximal.push(entry);
    }
    for (const entry of maximal) this.context = this.context.merge(entry.vv);
    return maximal.map((entry) => entry.value);
  }
}
