import type { DomainEvent, EventStore, Snapshot, SnapshotStore } from "./types.js";
import type { Aggregate } from "./aggregate.js";
import { AggregateNotFoundError } from "./errors.js";

function isUsableSnapshot(snapshot: Snapshot, id: string): boolean {
  return (
    snapshot.valid !== false &&
    snapshot.aggregateId === id &&
    typeof snapshot.version === "number" &&
    Number.isFinite(snapshot.version) &&
    snapshot.version >= 0 &&
    snapshot.state !== null &&
    snapshot.state !== undefined
  );
}

export class Repository<T extends Aggregate> {
  constructor(
    private readonly opts: {
      eventStore: EventStore;
      snapshotStore: SnapshotStore;
      snapshotThreshold: number;
      rehydrate: (id: string, events: DomainEvent[], snapshot: Snapshot | null) => T;
      toSnapshot?: (aggregate: T) => Snapshot;
    },
  ) {}

  load(id: string): T {
    const raw = this.opts.snapshotStore.load(id);
    const snapshot = raw !== null && isUsableSnapshot(raw, id) ? raw : null;
    const events = this.opts.eventStore.load(id, snapshot ? snapshot.version : 0);
    if (!snapshot && events.length === 0) {
      throw new AggregateNotFoundError(`aggregate not found: ${id}`);
    }
    return this.opts.rehydrate(id, events, snapshot);
  }

  save(aggregate: T): void {
    const events = aggregate.pullUncommittedEvents();
    if (events.length === 0) {
      return;
    }
    const expectedVersion = aggregate.version - events.length;
    this.opts.eventStore.append(aggregate.id, events, expectedVersion);
    if (
      this.opts.toSnapshot &&
      this.opts.snapshotThreshold > 0 &&
      aggregate.version % this.opts.snapshotThreshold === 0
    ) {
      this.opts.snapshotStore.save(this.opts.toSnapshot(aggregate));
    }
  }
}
