/** FIFO backlog queue for messages that arrived without available credit. */
export class BacklogQueue {
  private readonly items: string[] = [];

  push(msg: string): void {
    this.items.push(msg);
  }

  shift(): string | undefined {
    return this.items.shift();
  }

  size(): number {
    return this.items.length;
  }

  peek(): string | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items.length = 0;
  }
}
