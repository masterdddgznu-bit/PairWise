import type { DomainEvent, Snapshot } from "./types.js";

let logicalClock = 0;
let eventSeq = 0;

export abstract class Aggregate {
  abstract readonly id: string;
  version = 0;
  private uncommittedEvents: DomainEvent[] = [];

  protected raise(type: string, payload: unknown): void {
    const event: DomainEvent = {
      eventId: `evt-${++eventSeq}`,
      aggregateId: this.id,
      type,
      payload,
      version: this.version + 1,
      occurredAt: ++logicalClock,
    };
    this.apply(event);
    this.uncommittedEvents.push(event);
  }

  abstract applyState(event: DomainEvent): void;

  apply(event: DomainEvent): void {
    this.applyState(event);
    this.version = event.version;
  }

  pullUncommittedEvents(): DomainEvent[] {
    const events = this.uncommittedEvents;
    this.uncommittedEvents = [];
    return events;
  }
}

/** Demo aggregate for tests. */
export class CounterAggregate extends Aggregate {
  count = 0;

  constructor(readonly id: string) {
    super();
  }

  static create(id: string): CounterAggregate {
    const aggregate = new CounterAggregate(id);
    aggregate.raise("CounterCreated", {});
    return aggregate;
  }

  increment(by = 1): void {
    this.raise("CounterIncremented", { by });
  }

  applyState(event: DomainEvent): void {
    switch (event.type) {
      case "CounterCreated":
        break;
      case "CounterIncremented": {
        const payload = event.payload as { by?: number };
        this.count += payload.by ?? 1;
        break;
      }
    }
  }

  static rehydrate(id: string, events: DomainEvent[], snapshot: Snapshot | null): CounterAggregate {
    const aggregate = new CounterAggregate(id);
    if (snapshot) {
      const state = snapshot.state as { count?: number };
      aggregate.count = state.count ?? 0;
      aggregate.version = snapshot.version;
    }
    for (const event of events) {
      aggregate.apply(event);
    }
    return aggregate;
  }

  toSnapshot(): Snapshot {
    return {
      aggregateId: this.id,
      version: this.version,
      state: { count: this.count },
      valid: true,
    };
  }
}
