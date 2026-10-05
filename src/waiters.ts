export interface Waiter {
  ticket: number;
  holder: string;
}

export class WaitQueue {
  private readonly queue: Waiter[] = [];
  private readonly seenTickets = new Set<number>();

  get size(): number {
    return this.queue.length;
  }

  enqueue(waiter: Waiter): void {
    this.queue.push(waiter);
    this.seenTickets.add(waiter.ticket);
  }

  dequeue(): Waiter | undefined {
    return this.queue.shift();
  }

  hasHolder(holder: string): boolean {
    return this.queue.some((w) => w.holder === holder);
  }

  hasSeenTicket(ticket: number): boolean {
    return this.seenTickets.has(ticket);
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
