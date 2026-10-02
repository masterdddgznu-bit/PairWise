import type { ReplicLog } from "./log.js";
import { listHealthy, requiredAcks, countWithEntry } from "./quorum.js";
import { InsufficientReplicasError } from "./errors.js";

/** BUG: replicate only to one follower (not w-1 followers). */
export function leaderAppend(rl: ReplicLog, payload: string): { index: number } {
  const opts = rl.getOpts();
  const leaderId = 0;
  const leader = rl.getReplicas()[leaderId]!;
  const index = leader.lastIndex() + 1;
  leader.appendAt(index, payload);

  const healthy = listHealthy(opts.n, rl.getHealth().down);
  const followers = healthy.filter((id) => id !== leaderId);
  const target = followers[0];
  if (target !== undefined) {
    rl.getReplicas()[target]!.appendAt(index, payload);
  }

  const need = requiredAcks(opts.n, opts.w);
  const acks = countWithEntry(healthy, (id, idx) => rl.getReplicas()[id]!.has(idx), index);
  if (acks < need) {
    throw new InsufficientReplicasError();
  }

  rl.setCommitted(Math.max(rl.getCommitted(), index));
  return { index };
}

/** BUG: allows gaps — returns max index with any quorum instead of contiguous prefix. */
export function recomputeCommitted(rl: ReplicLog): number {
  const opts = rl.getOpts();
  const healthy = listHealthy(opts.n, rl.getHealth().down);
  const need = requiredAcks(opts.n, opts.w);
  let max = 0;
  for (let i = 1; i <= rl.getReplicas()[0]!.lastIndex(); i++) {
    const acks = countWithEntry(healthy, (id, idx) => rl.getReplicas()[id]!.has(idx), i);
    if (acks >= need) max = i;
  }
  return max;
}
