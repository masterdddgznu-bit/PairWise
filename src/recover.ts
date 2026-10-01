import type { DedupSnapshot } from "./types.js";
import type { DedupStore } from "./store.js";
import type { VirtualClock } from "./clock.js";
import { isActive } from "./entry.js";
import { InvalidSnapshotError } from "./errors.js";

export function exportSnapshot(store: DedupStore): DedupSnapshot {
  return { entries: store.all() };
}

/** Restore dedup log from crash snapshot. */
export function importSnapshot(
  store: DedupStore,
  clock: VirtualClock,
  ttlMs: number,
  snapshot: DedupSnapshot,
): void {
  if (!snapshot || !Array.isArray(snapshot.entries)) {
    throw new InvalidSnapshotError();
  }
  const now = clock.now();
  const entries = snapshot.entries
    .filter((e) => isActive(e, now, ttlMs))
    .map((e) => ({
      tenant: e.tenant,
      id: e.id,
      seenAt: e.seenAt,
    }));
  store.replaceAll(entries);
}
