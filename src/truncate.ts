import type { ReplicLog } from "./log.js";
import { listHealthy } from "./quorum.js";
import { recomputeCommitted } from "./leader.js";

export function truncateAfter(rl: ReplicLog, index: number): void {
  if (index < 0) return;
  rl.getReplicas()[0]!.truncateAfter(index);
  const cur = rl.getCommitted();
  rl.setCommitted(Math.max(cur, index));
}
