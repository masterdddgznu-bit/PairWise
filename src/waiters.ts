export interface Waiter {
  ticket: number;
  holder: string;
}

export class WaitQueue {
  private queue: Waiter[] = [];
  private readonly issued = new Set<number>();

  enqueue(ticket: number, holder: string): void {
    this.issued.add(ticket);
    this.queue.push({ ticket, holder });
  }

  dequeue(): Waiter | undefined {
    return this.queue.shift();
  }

  get size(): number {
    return this.queue.length;
  }

  hasHolder(holder: string): boolean {
    return this.queue.some((w) => w.holder === holder);
  }

  hasTicket(ticket: number): boolean {
    return this.issued.has(ticket);
  }

  remove(ticket: number): boolean {
    const idx = this.queue.findIndex((w) => w.ticket === ticket);
    if (idx < 0) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  tickets(): number[] {
    return this.queue.map((w) => w.ticket);
  }

  holders(): string[] {
    return this.queue.map((w) => w.holder);
  }
}
