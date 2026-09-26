import type { OutboxMessage } from "./types.js";
import type { OutboxStore } from "./outbox_store.js";

/** Per-key gate: earlier offsets must be settled before delivering later ones. */
export class KeyOrderingGate {
  constructor(private readonly outbox: OutboxStore) {}

  canDeliver(msg: OutboxMessage): boolean {
    const priors = this.outbox
      .listByKey(msg.key)
      .filter((m) => m.offset < msg.offset);
    return priors.every((m) => m.status === "published");
  }
}
