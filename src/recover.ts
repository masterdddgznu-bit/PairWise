import type { QuorumSnapshot } from "./types.js";
import type { QuorumKV } from "./client.js";

export function exportSnapshot(kv: QuorumKV): QuorumSnapshot {
  const opts = kv.getOpts();
  return {
    n: opts.n,
    r: opts.r,
    w: opts.w,
    replicas: kv.getReplicas().map((r) => r.snapshot()),
    down: kv.getHealth().snapshotDown(),
  };
}

export function importSnapshot(kv: QuorumKV, state: QuorumSnapshot): void {
  const replicas = kv.getReplicas();
  for (let i = 0; i < replicas.length; i++) {
    replicas[i]!.restore(state.replicas[i] ?? {});
  }
  kv.getHealth().restoreDown(state.down ?? []);
}
