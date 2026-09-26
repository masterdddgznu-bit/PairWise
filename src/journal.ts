import type { JournalEvent } from "./types.js";

/** Append-only durable event log. */
export class Journal {
  private events: JournalEvent[] = [];

  append(ev: JournalEvent): void {
    this.events.push(ev);
  }

  list(): JournalEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
