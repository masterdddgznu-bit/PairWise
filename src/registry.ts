export interface WorkItem {
  id: string;
  payload: unknown;
  dueAt: number;
  cost: number;
  seq: number;
  frozen: boolean;
}

export class Registry {
  private items = new Map<string, WorkItem>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  size(): number {
    return this.items.size;
  }

  add(id: string, payload: unknown, dueAt: number, cost: number): WorkItem {
    const item: WorkItem = { id, payload, dueAt, cost, seq: this.nextSeq++, frozen: false };
    this.items.set(id, item);
    return item;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  /** All items in first-registration order. */
  inOrder(): WorkItem[] {
    return [...this.items.values()].sort((a, b) => a.seq - b.seq);
  }
}
