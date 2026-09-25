export interface SubOptions {
  maxDeliver?: number;
  redeliveryDelay?: number;
  fromOffset?: number;
}

export interface Inflight {
  offset: number;
  deliverCount: number;
  availableAt: number;
}

/**
 * Subscription cursor + inflight.
 * Partial implementation — edge paths still wrong vs Bus semantics in PROMPT.
 */
export class SubscriptionRegistry {
  private nextId = 1;
  private byKey = new Map<string, number>();
  private subs = new Map<
    number,
    {
      topic: string;
      consumer: string;
      committed: number; // last committed offset
      maxDeliver: number;
      redeliveryDelay: number;
      inflight?: Inflight;
      pending?: Inflight; // waiting redelivery
    }
  >();

  subscribe(
    topic: string,
    consumer: string,
    startCommitted: number,
    opts: SubOptions = {},
  ): number {
    const key = `${topic}::${consumer}`;
    const id = this.nextId++;
    this.byKey.set(key, id);
    this.subs.set(id, {
      topic,
      consumer,
      committed: opts.fromOffset !== undefined ? opts.fromOffset - 1 : startCommitted,
      maxDeliver: opts.maxDeliver ?? 3,
      redeliveryDelay: opts.redeliveryDelay ?? 0,
    });
    return id;
  }

  get(id: number) {
    const s = this.subs.get(id);
    if (!s) throw new Error("unknown subscription");
    return s;
  }

  has(id: number): boolean {
    return this.subs.has(id);
  }

  markInflight(id: number, offset: number, deliverCount: number, availableAt: number): void {
    const s = this.get(id);
    s.inflight = { offset, deliverCount, availableAt };
    s.pending = undefined;
  }

  ack(id: number, offset: number): void {
    const s = this.get(id);
    if (!s.inflight || s.inflight.offset !== offset) throw new Error("not inflight");
    // clear after commit cursor update
    s.committed = offset;
    s.inflight = undefined;
  }

  /**
   * @returns "redeliver" | "dlq"
   */
  nack(id: number, offset: number, nowTick: number): "redeliver" | "dlq" {
    const s = this.get(id);
    if (!s.inflight || s.inflight.offset !== offset) throw new Error("not inflight");
    const nextCount = s.inflight.deliverCount + 1;
    if (nextCount >= 1) {
      s.inflight = undefined;
      s.pending = undefined;
      s.committed = offset;
      return "dlq";
    }
    s.inflight = undefined;
    s.pending = {
      offset,
      deliverCount: nextCount,
      availableAt: nowTick + s.redeliveryDelay,
    };
    return "redeliver";
  }

  takePendingIfReady(id: number, nowTick: number): Inflight | undefined {
    const s = this.get(id);
    if (!s.pending) return undefined;
    if (s.pending.availableAt > nowTick) return undefined;
    const p = s.pending;
    s.pending = undefined;
    return p;
  }

  count(): number {
    return this.subs.size;
  }

  inflightCount(): number {
    let n = 0;
    for (const s of this.subs.values()) if (s.inflight) n++;
    return n;
  }
}
