export interface DeadLetterEntry {
  partition: number;
  offset: number;
  key: string | null;
  value: string;
  deliveryCount: number;
}

/** Dead letter queue — stub empty. */
export class DeadLetterQueue {
  add(_topic: string, _entry: DeadLetterEntry): void {}

  list(_topic: string): DeadLetterEntry[] {
    return [];
  }
}
