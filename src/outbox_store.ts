import type { OutboxMessage, OutboxStats } from "./types.js";

/** Durable outbox rows with status transitions. */
export class OutboxStore {
  private rows: OutboxMessage[] = [];
  private nextOffset = 0;

  append(input: {
    messageId: string;
    key: string;
    payload: string;
  }): OutboxMessage {
    const row: OutboxMessage = {
      offset: this.nextOffset++,
      messageId: input.messageId,
      key: input.key,
      payload: input.payload,
      status: "pending",
      attempts: 0,
    };
    this.rows.push(row);
    return { ...row };
  }

  hasMessageId(messageId: string): boolean {
    return this.rows.some((r) => r.messageId === messageId);
  }

  findByMessageId(messageId: string): OutboxMessage | undefined {
    const found = this.rows.find((r) => r.messageId === messageId);
    return found ? { ...found } : undefined;
  }

  list(): OutboxMessage[] {
    return this.rows.map((r) => ({ ...r }));
  }

  listByKey(key: string): OutboxMessage[] {
    return this.rows.filter((r) => r.key === key).map((r) => ({ ...r }));
  }

  markInFlight(offset: number, visibilityDeadline: number): void {
    const row = this.rows.find((r) => r.offset === offset);
    if (!row || row.status !== "pending") return;
    row.status = "in_flight";
    row.visibilityDeadline = visibilityDeadline;
    row.nextAttemptAt = undefined;
    row.attempts += 1;
  }

  markPublished(offset: number): void {
    const row = this.rows.find((r) => r.offset === offset);
    if (!row || row.status !== "in_flight") return;
    row.status = "published";
    row.visibilityDeadline = undefined;
    row.nextAttemptAt = undefined;
  }

  markPending(offset: number, nextAttemptAt: number): void {
    const row = this.rows.find((r) => r.offset === offset);
    if (!row || row.status !== "in_flight") return;
    row.status = "pending";
    row.visibilityDeadline = undefined;
    row.nextAttemptAt = nextAttemptAt;
  }

  bumpAttempts(offset: number): number {
    const row = this.rows.find((r) => r.offset === offset);
    if (!row) return 0;
    row.attempts += 1;
    return row.attempts;
  }

  stats(): OutboxStats {
    const counts = { pending: 0, inFlight: 0, published: 0 };
    for (const r of this.rows) {
      if (r.status === "pending") counts.pending += 1;
      else if (r.status === "in_flight") counts.inFlight += 1;
      else counts.published += 1;
    }
    return counts;
  }
}
