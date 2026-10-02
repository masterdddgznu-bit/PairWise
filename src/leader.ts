import type { ReplicLog } from "./log.js";
import { listHealthy, requiredAcks, countWithEntry } from "./quorum.js";
import { InsufficientReplicasError } from "./errors.js";

export function leaderAppend(rl: ReplicLog, payload: string): { index: number } {
  const opts = rl.getOpts();
  const leaderId = 0;
  const replicas = rl.getReplicas();
  const leader = replicas[leaderId]!;
  const healthy = listHealthy(opts.n, rl.getHealth().down);
  const need = requiredAcks(opts.n, opts.w);
  if (healthy.length < need) {
    throw new InsufficientReplicasError();
  }

  const index = leader.lastIndex() + 1;
  leader.appendAt(index, payload);

  let holders = 1;
  for (const id of healthy) {
    if (id === leaderId) continue;
    if (holders >= need) break;
    const follower = replicas[id]!;
    follower.appendAt(index, payload);
    if (follower.has(index)) holders += 1;
  }

  const acks = countWithEntry(healthy, (id, idx) => replicas[id]!.has(idx), index);
  if (acks < need) {
    throw new InsufficientReplicasError();
  }

  return { index };
}

export function recomputeCommitted(rl: ReplicLog): number {
  const opts = rl.getOpts();
  const healthy = listHealthy(opts.n, rl.getHealth().down);
  const need = requiredAcks(opts.n, opts.w);
  let committed = 0;
  const last = rl.getReplicas()[0]!.lastIndex();
  for (let i = 1; i <= last; i++) {
    const acks = countWithEntry(healthy, (id, idx) => rl.getReplicas()[id]!.has(idx), i);
    if (acks >= need) {
      committed = i;
    } else {
      break;
    }
  }
  return committed;
}
