import type { ReplicLogSnapshot } from "./types.js";
import type { ReplicLog } from "./log.js";

export function exportSnapshot(rl: ReplicLog): ReplicLogSnapshot {
  const opts = rl.getOpts();
  return {
    n: opts.n,
    w: opts.w,
    committed: rl.getCommitted(),
    down: rl.getHealth().snapshotDown(),
    logs: rl.getReplicas().map((r) => r.snapshot()),
  };
}

export function importSnapshot(rl: ReplicLog, state: ReplicLogSnapshot): void {
  const replicas = rl.getReplicas();
  for (let i = 0; i < replicas.length; i++) {
    replicas[i]!.restore(state.logs[i] ?? []);
  }
  rl.setCommitted(state.committed);
  rl.getHealth().restoreDown(state.down);
}
