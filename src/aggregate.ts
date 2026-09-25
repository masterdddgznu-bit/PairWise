import type { DomainEvent, Snapshot } from "./types.js";

let eventSeq = 0;
let clockSeq = 0;

function nextEventId(): string {
  eventSeq += 1;
  return `evt-${eventSeq}`;
}

function nextTick(): number {
  clockSeq += 1;
  return clockSeq;
}

export abstract class Aggregate {
  abstract readonly id: string;
  version = 0;

  private uncommittedEvents: DomainEvent[] = [];

  protected raise(type: string, payload: unknown): void {
    const event: DomainEvent = {
      eventId: nextEventId(),
      aggregateId: this.id,
      type,
      payload,
      version: this.version + 1,
      occurredAt: nextTick(),
    };
    this.uncommittedEvents.push(event);
    this.apply(event);
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

/** Demo aggregate for tests: a simple counter. */
export class CounterAggregate extends Aggregate {
  count = 0;

  constructor(readonly id: string) {
    super();
  }

  static create(id: string): CounterAggregate {
    const aggregate = new CounterAggregate(id);
    aggregate.raise("created", {});
    return aggregate;
  }

  increment(by = 1): void {
    this.raise("incremented", { by });
  }

  applyState(event: DomainEvent): void {
    if (event.type === "created") {
      this.count = 0;
    } else if (event.type === "incremented") {
      const payload = event.payload as { by?: number };
      this.count += payload.by ?? 1;
    }
  }

  static rehydrate(id: string, events: DomainEvent[], snapshot: Snapshot | null): CounterAggregate {
    const aggregate = new CounterAggregate(id);
    if (snapshot) {
      const state = snapshot.state as { count: number };
      aggregate.count = state.count;
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
