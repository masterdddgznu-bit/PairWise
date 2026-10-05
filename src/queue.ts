export interface QueueEntry {
  id: string;
  payload: unknown;
}

export class FifoQueue {
  private readonly entries = new Map<string, unknown>();

  has(id: string): boolean {
    return this.entries.has(id);
  }

  set(id: string, payload: unknown): void {
    this.entries.set(id, payload);
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  shift(): QueueEntry | null {
    const first = this.entries.entries().next();
    if (first.done) {
      return null;
    }
    const [id, payload] = first.value;
    this.entries.delete(id);
    return { id, payload };
  }

  peek(): QueueEntry | null {
    const first = this.entries.entries().next();
    if (first.done) {
      return null;
    }
    const [id, payload] = first.value;
    return { id, payload };
  }

  size(): number {
    return this.entries.size;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }
}
