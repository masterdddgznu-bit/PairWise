import type { VirtualClock } from "./clock.js";
import type { MessageBus } from "./bus.js";
import type { OutboxStore } from "./outbox_store.js";
import type { KeyOrderingGate } from "./ordering.js";
import type { RetryPolicy } from "./retry.js";

/** Polls outbox, enforces ordering, delivers to bus, manages visibility/retry. */
export class OutboxRelay {
  constructor(
    private readonly clock: VirtualClock,
    private readonly outbox: OutboxStore,
    private readonly bus: MessageBus,
    private readonly ordering: KeyOrderingGate,
    private readonly retry: RetryPolicy,
    private readonly visibilityTimeout: number,
  ) {}

  clearVolatile(): void {
    // Relay keeps no volatile delivery state; durable rows drive recovery.
  }

  reclaimDue(): void {
    const now = this.clock.now();
    for (const msg of this.outbox.list()) {
      if (msg.status !== "in_flight") continue;
      if (msg.visibilityDeadline === undefined) continue;
      if (now >= msg.visibilityDeadline) {
        const attempts = this.outbox.bumpAttempts(msg.offset);
        const delay = this.retry.delayForAttempt(attempts - 1);
        this.outbox.markPending(msg.offset, now + delay);
      }
    }
  }

  deliverOnce(): void {
    const now = this.clock.now();

    const candidates = this.outbox
      .list()
      .filter((m) => m.status === "pending")
      .sort((a, b) => a.offset - b.offset);

    for (const msg of candidates) {
      if (msg.nextAttemptAt !== undefined && now < msg.nextAttemptAt) continue;
      if (!this.ordering.canDeliver(msg)) continue;

      this.outbox.markInFlight(msg.offset, now + this.visibilityTimeout);

      try {
        this.bus.publish({
          messageId: msg.messageId,
          key: msg.key,
          payload: msg.payload,
          offset: msg.offset,
        });
      } catch {
        // Delivery failed: stay in_flight until visibility deadline reclaims.
        continue;
      }
      this.outbox.markPublished(msg.offset);
    }
  }

  tick(): void {
    this.reclaimDue();
    this.deliverOnce();
  }
}
