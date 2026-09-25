export interface DeadLetterEntry {
  partition: number;
  offset: number;
  key: string | null;
  value: string;
  deliveryCount: number;
}

/** Dead letter queue for messages exceeding max deliveries. */
export class DeadLetterQueue {
  private entries = new Map<string, DeadLetterEntry[]>();

  add(topic: string, entry: DeadLetterEntry): void {
    const list = this.entries.get(topic) ?? [];
    list.push(entry);
    this.entries.set(topic, list);
  }

  list(topic: string): DeadLetterEntry[] {
    return [...(this.entries.get(topic) ?? [])];
  }
}
