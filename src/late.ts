import type { LateEvent } from "./types.js";

export class LateBuffer {
  push(_ev: LateEvent): void {}
  drain(): LateEvent[] {
    return [];
  }
  exportAll(): LateEvent[] {
    return [];
  }
  importAll(_evs: LateEvent[]): void {}
}
