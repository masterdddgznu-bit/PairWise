export interface DeadLetterEntry {
  partition: number;
  offset: number;
  key: string | null;
  value: string;
  deliveryCount: number;
}

/** Per-topic dead letter queue for poison messages. */
export class DeadLetterQueue {
  private entries = new Map<string, DeadLetterEntry[]>();

  add(topic: string, entry: DeadLetterEntry): void {
    let list = this.entries.get(topic);
    if (!list) {
      list = [];
      this.entries.set(topic, list);
    }
    list.push(entry);
  }

  list(topic: string): DeadLetterEntry[] {
    return [...(this.entries.get(topic) ?? [])];
  }
}
