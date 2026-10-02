import type { ReplicLog } from "./log.js";
import { listHealthy } from "./quorum.js";

export function truncateAfter(rl: ReplicLog, index: number): void {
  if (index < 0) return;
  const opts = rl.getOpts();
  const healthy = listHealthy(opts.n, rl.getHealth().down);
  for (const id of healthy) {
    rl.getReplicas()[id]!.truncateAfter(index);
  }
}
