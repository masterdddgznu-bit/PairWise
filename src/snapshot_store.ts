import type { Snapshot, SnapshotStore } from "./types.js";

/** In-memory snapshot store with a test hook to corrupt snapshots. */
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();

  save(snapshot: Snapshot): void {
    this.snapshots.set(snapshot.aggregateId, snapshot);
  }

  load(aggregateId: string): Snapshot | null {
    return this.snapshots.get(aggregateId) ?? null;
  }

  corrupt(aggregateId: string): void {
    const existing = this.snapshots.get(aggregateId);
    if (existing) {
      this.snapshots.set(aggregateId, { ...existing, valid: false });
    }
  }
}
