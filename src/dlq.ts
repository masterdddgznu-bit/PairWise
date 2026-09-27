import type { Message } from "./types.js";

export class DeadLetterQueue {
  private readonly items: Message[] = [];

  push(msg: Message): void {
    this.items.push({ ...msg });
  }

  list(): Message[] {
    return [...this.items];
  }

  take(id: string): Message | undefined {
    const idx = this.items.findIndex((m) => m.id === id);
    if (idx < 0) return undefined;
    const [msg] = this.items.splice(idx, 1);
    return msg;
  }
}
