import type { Replica } from "./replica.js";

/**
 * Pull-based anti-entropy: `to` fetches every op from `from` that its own
 * store version vector does not already cover. `Replica.applyRemote`
 * deduplicates, so repeated syncs are idempotent.
 */
export function syncReplica(from: Replica, to: Replica): void {
  const covered = to.storeVV();
  for (const op of from.ops()) {
    if (!covered.coversOp(op.replicaId, op.counter)) {
      to.applyRemote(op);
    }
  }
}

/**
 * Exchange updates over every unordered pair. One bidirectional round per
 * pair converges the cluster: each pull ships the source's complete log and
 * the "already covered" sets only grow.
 */
export function syncAllPairs(replicas: Replica[]): void {
  for (let i = 0; i < replicas.length; i++) {
    for (let j = i + 1; j < replicas.length; j++) {
      syncReplica(replicas[i], replicas[j]);
      syncReplica(replicas[j], replicas[i]);
    }
  }
}
