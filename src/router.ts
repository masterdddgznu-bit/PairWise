import type { QuorumKV } from "./client.js";
import { listHealthy, pickQuorum } from "./quorum.js";
import { pickHighest } from "./version.js";
import { StaleWriteError } from "./errors.js";

/** BUG: one replica, no read quorum, global version bleed, no re-bump same key. */
export function routePut(
  kv: QuorumKV,
  key: string,
  value: string,
  expectedVersion?: number,
): { version: number } {
  const existing = kv.getReplicas()[0]!.get(key);
  const version = existing ? existing.version : kv.bumpGlobal();
  if (expectedVersion !== undefined && version <= expectedVersion) {
    throw new StaleWriteError();
  }
  kv.getReplicas()[0]!.put(key, { value, version });
  return { version };
}

/** BUG: no read repair; pickHighest returns first. */
export function routeGet(kv: QuorumKV, key: string): { value: string; version: number } | undefined {
  const opts = kv.getOpts();
  const healthy = listHealthy(opts.n, kv.getHealth().down, kv.getHealth().stale);
  const readers = pickQuorum(healthy, opts.r);
  const entries = readers.map((id) => kv.getReplicas()[id]!.get(key));
  const best = pickHighest(entries);
  return best ? { value: best.value, version: best.version } : undefined;
}
