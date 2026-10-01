import type { BatchSnapshot } from "./types.js";
import type { PendingStore } from "./store.js";
import type { VirtualClock } from "./clock.js";

export function exportSnapshot(store: PendingStore): BatchSnapshot {
  return { pending: store.allRecords() };
}

/** Restore queue from crash snapshot. */
export function importSnapshot(
  store: PendingStore,
  clock: VirtualClock,
  snapshot: BatchSnapshot,
): void {
  const now = clock.now();
  const records = (snapshot.pending ?? []).map((r) => ({
    tenant: r.tenant,
    payload: r.payload,
    enqueuedAt: now,
  }));
  store.replaceAll(records);
}
