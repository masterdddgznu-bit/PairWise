import { VirtualClock } from "./clock.js";
import { DomainStore } from "./domain_store.js";
import { OutboxStore } from "./outbox_store.js";
import { InboxStore } from "./inbox_store.js";
import { KeyOrderingGate } from "./ordering.js";
import { RetryPolicy } from "./retry.js";
import { MessageBus } from "./bus.js";
import { ConsumerRegistry, type ConsumerHandler } from "./consumer.js";
import { OutboxRelay } from "./relay.js";
import type { OutboxStats } from "./types.js";

export type EngineOptions = {
  clock?: VirtualClock;
  visibilityTimeout?: number;
  retryBackoff?: number[];
};

/**
 * Facade: atomic domain+outbox commit, relay tick, crash/recover.
 * UnitOfWork is inlined inside commitWrite.
 */
export class OutboxEngine {
  readonly clock: VirtualClock;
  private readonly domain = new DomainStore();
  private readonly outbox = new OutboxStore();
  private readonly inbox = new InboxStore();
  private readonly bus = new MessageBus();
  private readonly consumers: ConsumerRegistry;
  private readonly relay: OutboxRelay;

  constructor(opts: EngineOptions = {}) {
    this.clock = opts.clock ?? new VirtualClock();
    const visibilityTimeout = opts.visibilityTimeout ?? 10;
    const backoff = opts.retryBackoff ?? [5, 10, 20];
    const ordering = new KeyOrderingGate(this.outbox);
    const retry = new RetryPolicy(backoff);
    this.consumers = new ConsumerRegistry(this.bus, this.inbox);
    this.relay = new OutboxRelay(
      this.clock,
      this.outbox,
      this.bus,
      ordering,
      retry,
      visibilityTimeout,
    );
  }

  commitWrite(input: {
    key: string;
    value: string;
    messageId: string;
    payload: string;
  }): void {
    if (this.outbox.findByMessageId(input.messageId)) {
      return;
    }
    this.domain.set(input.key, input.value);
    this.outbox.append({
      messageId: input.messageId,
      key: input.key,
      payload: input.payload,
    });
  }

  subscribe(consumerId: string, handler: ConsumerHandler): void {
    this.consumers.subscribe(consumerId, handler);
  }

  tick(): void {
    this.relay.tick();
  }

  domainGet(key: string): string | undefined {
    return this.domain.get(key);
  }

  effects(consumerId: string): string[] {
    return this.consumers.effectsOf(consumerId);
  }

  outboxStats(): OutboxStats {
    return this.outbox.stats();
  }

  crash(): void {
    this.relay.clearVolatile();
  }

  recover(): void {
    this.relay.reclaimDue();
  }
}
