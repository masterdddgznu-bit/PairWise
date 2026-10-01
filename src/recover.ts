import type { LimiterSnapshot } from "./types.js";
import type { EventStore } from "./store.js";
import { InvalidSnapshotError } from "./errors.js";

export function exportSnapshot(store: EventStore): LimiterSnapshot {
  return { events: store.all() };
}

/** Restore limiter from crash snapshot. */
export function importSnapshot(
  store: EventStore,
  snapshot: LimiterSnapshot,
): void {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.events)) {
    throw new InvalidSnapshotError();
  }
  const events = snapshot.events.map((e) => {
    if (
      !e ||
      typeof e !== "object" ||
      typeof e.tenant !== "string" ||
      typeof e.key !== "string" ||
      typeof e.ts !== "number" ||
      !Number.isFinite(e.ts)
    ) {
      throw new InvalidSnapshotError();
    }
    return { tenant: e.tenant, key: e.key, ts: e.ts };
  });
  store.replaceAll(events);
}
