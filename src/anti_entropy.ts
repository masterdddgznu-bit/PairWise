import type { Replica } from "./replica.js";

/** Pull missing operations from one replica into another. */
export function syncReplica(_from: Replica, _to: Replica): void {
  if (_from === _to) return;

  for (const op of _from.ops()) {
    if (!_to.hasOp(op.replicaId, op.counter)) {
      _to.applyRemote(op);
    }
  }
}

export function syncAllPairs(replicas: Replica[]): void {
  for (const source of replicas) {
    for (const target of replicas) {
      syncReplica(source, target);
    }
  }
}
