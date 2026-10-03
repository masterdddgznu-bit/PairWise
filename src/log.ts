import type { LogRecord } from "./types.js";

export class EventLog {
  readonly capacity: number;
  private readonly records: LogRecord[] = [];
  private nextSeq = 1;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  append(topic: string, payload: string): LogRecord {
    const rec: LogRecord = { seq: this.nextSeq++, topic, payload };
    this.records.push(rec);
    while (this.records.length > this.capacity) this.records.shift();
    return rec;
  }

  from(seq: number): LogRecord[] {
    return this.records.filter((r) => r.seq >= seq);
  }

  size(): number {
    return this.records.length;
  }
}
