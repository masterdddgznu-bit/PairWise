import type { StreamEvent } from "./types.js";

export class SideOutput {
  private readonly items: StreamEvent[] = [];

  push(ev: StreamEvent): void {
    this.items.push({ ...ev });
  }

  list(): StreamEvent[] {
    return this.items.map((e) => ({ ...e }));
  }
}
