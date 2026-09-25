export interface DeadLetter {
  topic: string;
  consumer: string;
  offset: number;
  payload: string;
  deliverCount: number;
}

/** Dead-letter queue. Complete enough. */
export class DeadLetterQueue {
  private items: DeadLetter[] = [];

  push(item: DeadLetter): void {
    this.items.push({ ...item });
  }

  list(): DeadLetter[] {
    return this.items.map((x) => ({ ...x }));
  }

  size(): number {
    return this.items.length;
  }
}
