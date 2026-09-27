import type { Message } from "./types.js";

export class DeadLetterQueue {
  private readonly items: Message[] = [];

  push(_msg: Message): void {
    throw new Error("dlq push not implemented");
  }

  list(): Message[] {
    return [...this.items];
  }

  take(id: string): Message | undefined {
    throw new Error("dlq take not implemented");
  }
}
