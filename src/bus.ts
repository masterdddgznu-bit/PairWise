import type { BusMessage } from "./types.js";

export type BusHandler = (msg: BusMessage) => void;

/** In-memory fanout bus used by the relay. */
export class MessageBus {
  private handlers = new Map<string, BusHandler>();

  subscribe(consumerId: string, handler: BusHandler): void {
    this.handlers.set(consumerId, handler);
  }

  publish(msg: BusMessage): void {
    for (const handler of this.handlers.values()) {
      handler(msg);
    }
  }
}
