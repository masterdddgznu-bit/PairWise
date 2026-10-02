import type { ReplicLog } from "./log.js";
import { listHealthy, requiredAcks, countWithEntry } from "./quorum.js";
import { InsufficientReplicasError } from "./errors.js";

export function leaderAppend(rl: ReplicLog, payload: string): { index: number } {
  const opts = rl.getOpts();
  const leaderId = 0;
  const leader = rl.getReplicas()[leaderId]!;
  const healthy = listHealthy(opts.n, rl.getHealth().down);
  const need = requiredAcks(opts.n, opts.w);
  if (rl.getHealth().isDown(leaderId) || healthy.length < need) {
    throw new InsufficientReplicasError();
  }

  const index = leader.lastIndex() + 1;
  leader.appendAt(index, payload);

  const followers = healthy.filter((id) => id !== leaderId);
  for (const target of followers.slice(0, need - 1)) {
    rl.getReplicas()[target]!.appendAt(index, payload);
  }

  const acks = countWithEntry(healthy, (id, idx) => rl.getReplicas()[id]!.has(idx), index);
  if (acks < need) {
    throw new InsufficientReplicasError();
  }

  rl.setCommitted(recomputeCommitted(rl));
  return { index };
}

export function recomputeCommitted(rl: ReplicLog): number {
  const opts = rl.getOpts();
  const healthy = listHealthy(opts.n, rl.getHealth().down);
  const need = requiredAcks(opts.n, opts.w);
  let max = 0;
  for (let i = 1; i <= rl.getReplicas()[0]!.lastIndex(); i++) {
    const acks = countWithEntry(healthy, (id, idx) => rl.getReplicas()[id]!.has(idx), i);
    if (acks >= need) {
      max = i;
    } else {
      break;
    }
  }
  return max;
}
