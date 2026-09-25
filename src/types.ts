export type DomainEvent = {
  eventId: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  version: number;
  occurredAt: number;
};

export type Snapshot = {
  aggregateId: string;
  version: number;
  state: unknown;
  valid?: boolean;
};

export type Command = {
  commandId: string;
  aggregateId: string;
  type: "create" | "increment";
  by?: number;
};

export type CommandResult = {
  aggregateId: string;
  version: number;
};

export interface EventStore {
  append(aggregateId: string, events: DomainEvent[], expectedVersion: number): void;
  load(aggregateId: string, afterVersion?: number): DomainEvent[];
}

export interface SnapshotStore {
  save(snapshot: Snapshot): void;
  load(aggregateId: string): Snapshot | null;
  corrupt?(aggregateId: string): void;
}
