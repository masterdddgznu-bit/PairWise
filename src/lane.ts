export interface LaneItem<T = unknown> {
  id: string;
  payload: T;
  enqueuedAt: number;
}

export class Lane<T = unknown> {
  readonly name: string;
  credit: number;
  private readonly queue: LaneItem<T>[] = [];

  constructor(name: string, credit: number) {
    this.name = name;
    this.credit = credit;
  }

  get size(): number {
    return this.queue.length;
  }

  head(): LaneItem<T> | undefined {
    return this.queue[0];
  }

  enqueue(item: LaneItem<T>): void {
    this.queue.push(item);
  }

  dequeue(): LaneItem<T> | undefined {
    return this.queue.shift();
  }

  remove(id: string): boolean {
    const index = this.queue.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }

  ids(): string[] {
    return this.queue.map((item) => item.id);
  }

  enqueuedAtOf(id: string): number | null {
    const item = this.queue.find((entry) => entry.id === id);
    return item ? item.enqueuedAt : null;
  }

  servable(): boolean {
    return this.queue.length > 0 && this.credit >= 1;
  }
}
