import type { VirtualClock } from "./clock.js";
import type { MessageBus } from "./bus.js";
import type { OutboxStore } from "./outbox_store.js";
import type { KeyOrderingGate } from "./ordering.js";
import type { RetryPolicy } from "./retry.js";

/** Polls outbox, enforces ordering, delivers to bus, manages visibility/retry. */
export class OutboxRelay {
  private volatileCursor = 0;
  private replayPublished = false;

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
    this.replayPublished = true;
  }

  reclaimDue(): void {
    const now = this.clock.now();
    for (const msg of this.outbox.list()) {
      if (msg.status !== "in_flight") continue;
      if (msg.visibilityDeadline === undefined) continue;
      if (now > msg.visibilityDeadline) {
        const attempts = this.outbox.bumpAttempts(msg.offset);
        const delay = this.retry.delayForAttempt(attempts - 1);
        this.outbox.markPending(msg.offset, now + delay);
      }
    }
  }

  deliverOnce(): void {
    const now = this.clock.now();

    if (this.replayPublished) {
      for (const msg of this.outbox.list()) {
        if (msg.status !== "published") continue;
        try {
          this.bus.publish({
            messageId: msg.messageId,
            key: msg.key,
            payload: msg.payload,
            offset: msg.offset,
          });
        } catch {
          // ignore
        }
      }
      this.replayPublished = false;
    }

    const candidates = this.outbox
      .list()
      .filter((m) => m.status === "pending")
      .sort((a, b) => a.offset - b.offset);

    for (const msg of candidates) {
      // Skips nextAttemptAt gating — retries fire every tick.
      if (!this.ordering.canDeliver(msg)) continue;

      this.outbox.markInFlight(msg.offset, now + this.visibilityTimeout);
      this.volatileCursor = Math.max(this.volatileCursor, msg.offset + 1);

      // Publish ack before bus delivery; failures still remain published.
      this.outbox.markPublished(msg.offset);
      try {
        this.bus.publish({
          messageId: msg.messageId,
          key: msg.key,
          payload: msg.payload,
          offset: msg.offset,
        });
      } catch {
        // swallow
      }
    }
  }

  tick(): void {
    this.reclaimDue();
    this.deliverOnce();
  }
}
