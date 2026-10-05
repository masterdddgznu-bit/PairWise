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

export class EventLog {
  private entries: StampQEvent[] = [];

  append(
    at: number,
    type: EventType,
    fields: { id?: string; stamp?: number; watermark?: number } = {},
  ): StampQEvent {
    const event: StampQEvent = { seq: this.entries.length, at, type, ...fields };
    this.entries.push(event);
    return event;
  }

  all(): StampQEvent[] {
    return this.entries.map((e) => ({ ...e }));
  }
}
