import type { InflightItem, Message } from "./types.js";

/** In-flight map — starter: no visibility expiry. */
export class InflightMap {
  private readonly byId = new Map<string, InflightItem>();

  put(msg: Message, visibleUntil: number): void {
    this.byId.set(msg.id, { ...msg, visibleUntil });
  }

  get(id: string): InflightItem | undefined {
    return this.byId.get(id);
  }

  remove(id: string): InflightItem | undefined {
    const v = this.byId.get(id);
    if (v) this.byId.delete(id);
    return v;
  }

  /** Starter: never expires. */
  expired(_now: number): InflightItem[] {
    return [];
  }

  size(): number {
    return this.byId.size;
  }
}
