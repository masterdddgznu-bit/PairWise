import { MessageStore } from "./store.js";
import { SubscriptionRegistry, type SubOptions } from "./subscription.js";
import { Delivery } from "./delivery.js";
import { DeadLetterQueue } from "./dlq.js";

export interface BusStats {
  topics: number;
  messages: number;
  subscriptions: number;
  inflight: number;
  dlq: number;
}

/**
 * Facade. Wiring is mostly done; relies on fixed child modules.
 */
export class Bus {
  private store = new MessageStore();
  private subs = new SubscriptionRegistry();
  private dlq = new DeadLetterQueue();
  private delivery = new Delivery(this.store, this.subs);

  publish(topic: string, payload: string): number {
    return this.store.publish(topic, payload);
  }

  subscribe(topic: string, consumer: string, opts?: SubOptions): number {
    this.store.ensureTopic(topic);
    const start = this.store.lastOffset(topic);
    return this.subs.subscribe(topic, consumer, start, opts);
  }

  poll(subId: number, nowTick: number): { offset: number; payload: string } | null {
    const msg = this.delivery.next(subId, nowTick);
    if (!msg) return null;
    return { offset: msg.offset, payload: msg.payload };
  }

  ack(subId: number, offset: number): void {
    this.subs.ack(subId, offset);
  }

  nack(subId: number, offset: number, nowTick: number): void {
    const s = this.subs.get(subId);
    const result = this.subs.nack(subId, offset, nowTick);
    if (result === "dlq") {
      const msg = this.store.get(s.topic, offset);
      this.dlq.push({
        topic: s.topic,
        consumer: s.consumer,
        offset,
        payload: msg?.payload ?? "",
        deliverCount: s.maxDeliver,
      });
    }
  }

  stats(): BusStats {
    return {
      topics: this.store.topicCount(),
      messages: this.store.messageCount(),
      subscriptions: this.subs.count(),
      inflight: this.subs.inflightCount(),
      dlq: this.dlq.size(),
    };
  }

  dlqList() {
    return this.dlq.list();
  }
}
