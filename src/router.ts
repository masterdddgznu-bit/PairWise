import type { QuorumKV } from "./client.js";
import { listHealthy, pickQuorum } from "./quorum.js";
import { maxVersion, nextVersion, pickHighest } from "./version.js";
import { InsufficientReplicasError, StaleWriteError } from "./errors.js";

export function routePut(
  kv: QuorumKV,
  key: string,
  value: string,
  expectedVersion?: number,
): { version: number } {
  const opts = kv.getOpts();
  const healthy = listHealthy(opts.n, kv.getHealth().down, kv.getHealth().stale);
  if (healthy.length < opts.w) {
    throw new InsufficientReplicasError();
  }
  const readers = pickQuorum(healthy, opts.r);
  const seen = readers.map((id) => kv.getReplicas()[id]!.get(key));
  const seenMax = maxVersion(seen);
  if (expectedVersion !== undefined && seenMax > expectedVersion) {
    throw new StaleWriteError();
  }
  const version = nextVersion(seenMax);
  const writers = pickQuorum(healthy, opts.w);
  for (const id of writers) {
    kv.getReplicas()[id]!.put(key, { value, version });
  }
  return { version };
}

export function routeGet(kv: QuorumKV, key: string): { value: string; version: number } | undefined {
  const opts = kv.getOpts();
  const healthy = listHealthy(opts.n, kv.getHealth().down, kv.getHealth().stale);
  if (healthy.length < opts.r) {
    throw new InsufficientReplicasError();
  }
  const readers = pickQuorum(healthy, opts.r);
  const entries = readers.map((id) => kv.getReplicas()[id]!.get(key));
  const best = pickHighest(entries);
  if (best === undefined) return undefined;
  for (let i = 0; i < readers.length; i++) {
    const entry = entries[i];
    if (entry === undefined || entry.version < best.version) {
      kv.getReplicas()[readers[i]!]!.put(key, best);
    }
  }
  return { value: best.value, version: best.version };
}
