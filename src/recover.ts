import type { CacheSnapshot } from "./types.js";
import type { CacheStore } from "./store.js";
import type { VirtualClock } from "./clock.js";
import { computeExpiresAt } from "./entry.js";

export function exportSnapshot(store: CacheStore): CacheSnapshot {
  return {
    records: store.all(),
    generations: store.allGenerations(),
  };
}

/** Restore cache from crash snapshot. */
export function importSnapshot(
  store: CacheStore,
  clock: VirtualClock,
  defaultTtlMs: number,
  snapshot: CacheSnapshot,
): void {
  const now = clock.now();
  const records = (snapshot.records ?? []).map((r) => ({
    tenant: r.tenant,
    key: r.key,
    value: r.value,
    generation: r.generation,
    expiresAt: computeExpiresAt(now, defaultTtlMs),
  }));
  store.replaceAll(records, snapshot.generations ?? []);
}
