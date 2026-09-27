import type { InflightItem, Message } from "./types.js";

/** In-flight map with visibility-timeout expiry. */
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

  /** Remove and return items whose visibility deadline has passed. */
  expired(now: number): InflightItem[] {
    const out: InflightItem[] = [];
    for (const [id, item] of this.byId) {
      if (item.visibleUntil <= now) {
        this.byId.delete(id);
        out.push(item);
      }
    }
    return out;
  }

  size(): number {
    return this.byId.size;
  }
}
