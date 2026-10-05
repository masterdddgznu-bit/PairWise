export type EventType =
  | "offer"
  | "stamp"
  | "restamp"
  | "watermark"
  | "pop"
  | "cancel";

export interface StampQEvent {
  seq: number;
  at: number;
  type: EventType;
  id?: string;
  stamp?: number;
  watermark?: number;
}

export interface EventSink {
  now(): number;
}

/** Append-only redo log; every mutation gets a globally ordered entry. */
export class EventLog {
  private entries: StampQEvent[] = [];
  private nextSeq = 1;

  constructor(private readonly clock: EventSink) {}

  append(
    type: EventType,
    fields: { id?: string; stamp?: number; watermark?: number } = {},
  ): StampQEvent {
    const event: StampQEvent = { seq: this.nextSeq++, at: this.clock.now(), type };
    if (fields.id !== undefined) event.id = fields.id;
    if (fields.stamp !== undefined) event.stamp = fields.stamp;
    if (fields.watermark !== undefined) event.watermark = fields.watermark;
    this.entries.push(event);
    return event;
  }

  all(): StampQEvent[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
}
