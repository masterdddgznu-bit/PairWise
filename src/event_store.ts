import type { DomainEvent, EventStore } from "./types.js";
import { ConcurrencyError } from "./errors.js";

/** Append-only in-memory event store with per-aggregate optimistic concurrency. */
export class InMemoryEventStore implements EventStore {
  private readonly streams = new Map<string, DomainEvent[]>();

  append(aggregateId: string, events: DomainEvent[], expectedVersion: number): void {
    if (events.length === 0) {
      return;
    }
    const stream = this.streams.get(aggregateId) ?? [];
    const currentVersion = stream.length === 0 ? 0 : stream[stream.length - 1].version;
    if (currentVersion !== expectedVersion) {
      throw new ConcurrencyError(
        `aggregate ${aggregateId}: expected version ${expectedVersion}, actual ${currentVersion}`,
      );
    }
    this.streams.set(aggregateId, [...stream, ...events]);
  }

  load(aggregateId: string, afterVersion = 0): DomainEvent[] {
    const stream = this.streams.get(aggregateId) ?? [];
    return stream.filter((event) => event.version > afterVersion);
  }

  listAggregateIds(): string[] {
    return [...this.streams.keys()];
  }
}
