import type { QuorumKV } from "./client.js";
import type { KVEntry } from "./types.js";
import { listHealthy, pickQuorum } from "./quorum.js";
import { maxVersion, nextVersion, pickHighest } from "./version.js";
import { InsufficientReplicasError, StaleWriteError } from "./errors.js";

function readEntries(
  kv: QuorumKV,
  key: string,
  count: number,
): { ids: number[]; entries: (KVEntry | undefined)[] } {
  const opts = kv.getOpts();
  const healthy = listHealthy(opts.n, kv.getHealth().down, kv.getHealth().stale);
  if (healthy.length < count) throw new InsufficientReplicasError();
  const ids = pickQuorum(healthy, count);
  const entries = ids.map((id) => kv.getReplicas()[id]!.get(key));
  return { ids, entries };
}

function readRepair(kv: QuorumKV, key: string, ids: number[], target: KVEntry | undefined): void {
  if (!target) return;
  for (const id of ids) {
    const cur = kv.getReplicas()[id]!.get(key);
    if (!cur || cur.version < target.version || cur.value !== target.value) {
      kv.getReplicas()[id]!.put(key, { ...target });
    }
  }
}

export function routePut(
  kv: QuorumKV,
  key: string,
  value: string,
  expectedVersion?: number,
): { version: number } {
  const opts = kv.getOpts();
  const { entries } = readEntries(kv, key, opts.r);
  const seenMax = maxVersion(entries);
  if (expectedVersion !== undefined && seenMax > expectedVersion) {
    throw new StaleWriteError();
  }
  const version = nextVersion(seenMax);
  const healthy = listHealthy(opts.n, kv.getHealth().down, kv.getHealth().stale);
  if (healthy.length < opts.w) throw new InsufficientReplicasError();
  const writers = pickQuorum(healthy, opts.w);
  const entry: KVEntry = { value, version };
  for (const id of writers) {
    kv.getReplicas()[id]!.put(key, entry);
  }
  readRepair(kv, key, writers, entry);
  return { version };
}

export function routeGet(kv: QuorumKV, key: string): { value: string; version: number } | undefined {
  const opts = kv.getOpts();
  const { ids, entries } = readEntries(kv, key, opts.r);
  const best = pickHighest(entries);
  readRepair(kv, key, ids, best);
  return best ? { value: best.value, version: best.version } : undefined;
}
