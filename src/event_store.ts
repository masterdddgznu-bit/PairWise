import type { DomainEvent, EventStore } from "./types.js";
import { ConcurrencyError } from "./errors.js";

/** Append-only in-memory event store — stub does not persist. */
export class InMemoryEventStore implements EventStore {
  append(_aggregateId: string, _events: DomainEvent[], _expectedVersion: number): void {
    /* no-op */
  }

  load(_aggregateId: string, _afterVersion?: number): DomainEvent[] {
    return [];
  }

  listAggregateIds(): string[] {
    return [];
  }
}
