import type { LateEvent } from "./types.js";

function compare(a: LateEvent, b: LateEvent): number {
  if (a.eventTime !== b.eventTime) return a.eventTime - b.eventTime;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

export class LateBuffer {
  private events: LateEvent[] = [];

  push(ev: LateEvent): void {
    this.events.push(ev);
  }
  drain(): LateEvent[] {
    const out = [...this.events].sort(compare);
    this.events = [];
    return out;
  }
  exportAll(): LateEvent[] {
    return this.events.map((ev) => ({ ...ev }));
  }
  importAll(evs: LateEvent[]): void {
    this.events = evs.map((ev) => ({ ...ev }));
  }
}
