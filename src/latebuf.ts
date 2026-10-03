import type { LateEvent } from "./types.js";

export class LateBuffer {
  private items: LateEvent[] = [];

  push(e: LateEvent): void {
    this.items.push(e);
  }

  list(): LateEvent[] {
    return this.items.map((x) => ({ ...x }));
  }

  clear(): void {
    this.items = [];
  }

  exportState(): LateEvent[] {
    return this.list();
  }

  importState(items: LateEvent[]): void {
    this.items = items.map((x) => ({ ...x }));
  }
}
