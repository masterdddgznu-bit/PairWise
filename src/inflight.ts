type InflightEntry = {
  consumerId: string;
  seq: number;
  topic: string;
  payload: string;
  deliveredAt: number;
};

export class InflightBook {
  private readonly entries = new Map<string, InflightEntry>();

  private static key(consumerId: string, seq: number): string {
    return `${consumerId}${seq}`;
  }

  track(
    consumerId: string,
    seq: number,
    topic: string,
    payload: string,
    deliveredAt: number,
  ): void {
    this.entries.set(InflightBook.key(consumerId, seq), {
      consumerId,
      seq,
      topic,
      payload,
      deliveredAt,
    });
  }

  ack(consumerId: string, seq: number): boolean {
    return this.entries.delete(InflightBook.key(consumerId, seq));
  }

  nack(
    consumerId: string,
    seq: number,
    now: number,
  ): { topic: string; payload: string } | null {
    const entry = this.entries.get(InflightBook.key(consumerId, seq));
    if (!entry) return null;
    entry.deliveredAt = now;
    return { topic: entry.topic, payload: entry.payload };
  }

  due(now: number, ackTimeoutMs: number): Array<{
    consumerId: string;
    seq: number;
    topic: string;
    payload: string;
  }> {
    const out: Array<{
      consumerId: string;
      seq: number;
      topic: string;
      payload: string;
    }> = [];
    for (const entry of this.entries.values()) {
      if (now >= entry.deliveredAt + ackTimeoutMs) {
        out.push({
          consumerId: entry.consumerId,
          seq: entry.seq,
          topic: entry.topic,
          payload: entry.payload,
        });
      }
    }
    out.sort((a, b) => a.seq - b.seq);
    return out;
  }

  refresh(consumerId: string, seq: number, now: number): void {
    const entry = this.entries.get(InflightBook.key(consumerId, seq));
    if (entry) entry.deliveredAt = now;
  }
}
