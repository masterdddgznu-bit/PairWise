import type { BusMessage } from "./types.js";
import type { InboxStore } from "./inbox_store.js";
import type { MessageBus } from "./bus.js";

export type ConsumerHandler = (msg: {
  messageId: string;
  key: string;
  payload: string;
}) => void;

/** Wires subscribe handlers through inbox dedupe into a durable effects journal. */
export class ConsumerRegistry {
  private effects = new Map<string, string[]>();
  private handlers = new Map<string, ConsumerHandler>();

  constructor(
    private readonly bus: MessageBus,
    private readonly inbox: InboxStore,
  ) {}

  subscribe(consumerId: string, handler: ConsumerHandler): void {
    this.handlers.set(consumerId, handler);
    if (!this.effects.has(consumerId)) {
      this.effects.set(consumerId, []);
    }
    this.bus.subscribe(consumerId, (msg) => this.onBusMessage(consumerId, msg));
  }

  private onBusMessage(consumerId: string, msg: BusMessage): void {
    if (this.inbox.has(consumerId, msg.messageId)) {
      return;
    }
    const handler = this.handlers.get(consumerId);
    if (!handler) return;
    handler({
      messageId: msg.messageId,
      key: msg.key,
      payload: msg.payload,
    });
    this.inbox.mark(consumerId, msg.messageId);
    this.effects.get(consumerId)!.push(msg.payload);
  }

  effectsOf(consumerId: string): string[] {
    return [...(this.effects.get(consumerId) ?? [])];
  }
}
