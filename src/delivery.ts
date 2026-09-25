import type { Message, MessageStore } from "./store.js";
import type { SubscriptionRegistry } from "./subscription.js";

/**
 * Chooses the next message to deliver.
 * Partial: inflight / pending interaction still incorrect.
 */
export class Delivery {
  constructor(
    private store: MessageStore,
    private subs: SubscriptionRegistry,
  ) {}

  next(subId: number, nowTick: number): Message | null {
    const s = this.subs.get(subId);
    const pending = this.subs.takePendingIfReady(subId, nowTick);
    if (pending) {
      const msg = this.store.get(s.topic, pending.offset);
      if (!msg) return null;
      this.subs.markInflight(subId, pending.offset, pending.deliverCount, pending.availableAt);
      return msg;
    }
    const offset = s.committed + 1;
    const msg = this.store.get(s.topic, offset);
    if (!msg) return null;
    this.subs.markInflight(subId, offset, 1, nowTick);
    return msg;
  }
}
