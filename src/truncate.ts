import type { ReplicLog } from "./log.js";
import { listHealthy } from "./quorum.js";

export function truncateAfter(rl: ReplicLog, index: number): void {
  if (index < 0) return;
  const healthy = listHealthy(rl.getOpts().n, rl.getHealth().down);
  for (const id of healthy) {
    rl.getReplicas()[id]!.truncateAfter(index);
  }
  rl.setCommitted(Math.min(rl.getCommitted(), index));
}
