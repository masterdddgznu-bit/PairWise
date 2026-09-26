import type { BusMessage } from "./types.js";

export type BusHandler = (msg: BusMessage) => void;

/** In-memory fanout bus used by the relay. */
export class MessageBus {
  private handlers = new Map<string, BusHandler>();

  subscribe(consumerId: string, handler: BusHandler): void {
    this.handlers.set(consumerId, handler);
  }

  publish(msg: BusMessage): void {
    const failures: unknown[] = [];
    for (const handler of this.handlers.values()) {
      try {
        handler(msg);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more bus handlers failed");
    }
  }
}
