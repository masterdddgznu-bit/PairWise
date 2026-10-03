import type { LateEvent } from "./types.js";

function compare(a: LateEvent, b: LateEvent): number {
  if (a.eventTime !== b.eventTime) return a.eventTime - b.eventTime;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export class LateBuffer {
  private evs: LateEvent[] = [];
  push(ev: LateEvent): void {
    this.evs.push({ ...ev });
  }
  drain(): LateEvent[] {
    const out = [...this.evs].sort(compare);
    this.evs = [];
    return out;
  }
  exportAll(): LateEvent[] {
    return this.evs.map((e) => ({ ...e }));
  }
  importAll(evs: LateEvent[]): void {
    this.evs = evs.map((e) => ({ ...e }));
  }
}
