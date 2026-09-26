import type { VirtualClock } from "./clock.js";
import type { MessageBus } from "./bus.js";
import type { OutboxStore } from "./outbox_store.js";
import type { KeyOrderingGate } from "./ordering.js";
import type { RetryPolicy } from "./retry.js";

/** Polls outbox, enforces ordering, delivers to bus, manages visibility/retry. */
export class OutboxRelay {
  private volatileCursor = 0;

  constructor(
    private readonly clock: VirtualClock,
    private readonly outbox: OutboxStore,
    private readonly bus: MessageBus,
    private readonly ordering: KeyOrderingGate,
    private readonly retry: RetryPolicy,
    private readonly visibilityTimeout: number,
  ) {}

  clearVolatile(): void {
    this.volatileCursor = 0;
  }

  reclaimDue(): void {
    const now = this.clock.now();
    for (const msg of this.outbox.list()) {
      if (msg.status !== "in_flight") continue;
      if (msg.visibilityDeadline === undefined) continue;
      if (now >= msg.visibilityDeadline) {
        const delay = this.retry.delayForAttempt(msg.attempts - 1);
        this.outbox.markPending(msg.offset, now + delay);
      }
    }
  }

  deliverOnce(): void {
    const now = this.clock.now();

    const candidates = this.outbox
      .list()
      .filter((m) => m.status === "pending")
      .filter(
        (m) => m.nextAttemptAt === undefined || now >= m.nextAttemptAt,
      )
      .sort((a, b) => a.offset - b.offset);

    for (const msg of candidates) {
      if (!this.ordering.canDeliver(msg)) continue;

      this.outbox.markInFlight(msg.offset, now + this.visibilityTimeout);
      this.volatileCursor = Math.max(this.volatileCursor, msg.offset + 1);

      try {
        this.bus.publish({
          messageId: msg.messageId,
          key: msg.key,
          payload: msg.payload,
          offset: msg.offset,
        });
        this.outbox.markPublished(msg.offset);
      } catch {
      }
    }
  }

  tick(): void {
    this.reclaimDue();
    this.deliverOnce();
  }
}
