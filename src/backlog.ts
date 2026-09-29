/** FIFO backlog queue for messages waiting on credits. */
export class BacklogQueue {
  private readonly messages: string[] = [];

  push(msg: string): void {
    this.messages.push(msg);
  }

  shift(): string | undefined {
    return this.messages.shift();
  }

  size(): number {
    return this.messages.length;
  }

  peek(): string | undefined {
    return this.messages[0];
  }

  clear(): void {
    this.messages.length = 0;
  }
}
