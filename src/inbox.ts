import type { Envelope } from "./types.js";

export class InboxBook {
  private readonly boxes = new Map<string, Envelope[]>();

  push(consumerId: string, env: Envelope): void {
    let q = this.boxes.get(consumerId);
    if (!q) {
      q = [];
      this.boxes.set(consumerId, q);
    }
    q.push(env);
  }

  poll(consumerId: string): Envelope[] {
    const q = this.boxes.get(consumerId) ?? [];
    this.boxes.set(consumerId, []);
    return q;
  }

  size(consumerId: string): number {
    return (this.boxes.get(consumerId) ?? []).length;
  }
}
