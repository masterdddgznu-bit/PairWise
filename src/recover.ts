import type { PoolSnapshot } from "./types.js";
import type { LeaseStore } from "./store.js";
import { TokenGenerator } from "./token.js";

export function exportSnapshot(
  store: LeaseStore,
  tokens: TokenGenerator,
  inflight: Set<string>,
): PoolSnapshot {
  return {
    leases: store.all(),
    nextToken: tokens.exportCounters(),
    inflight: [...inflight],
  };
}

/** Restore pool from crash snapshot. */
export function importSnapshot(
  store: LeaseStore,
  tokens: TokenGenerator,
  inflight: Set<string>,
  snapshot: PoolSnapshot,
): void {
  store.replaceAll(snapshot.leases);
  tokens.reset();
  tokens.importCounters(snapshot.nextToken);
  for (const lease of snapshot.leases) {
    tokens.ensureAtLeast(lease.tenant, lease.resource, lease.token);
  }
  inflight.clear();
  for (const k of snapshot.inflight ?? []) {
    inflight.add(k);
  }
}
