import type { Message } from "./types.js";

export class BProc {
  readonly id: number;
  online = true;
  dist: number | null = null;
  parent: number | null = null;
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }

  reset(): void {
    this.dist = null;
    this.parent = null;
    this.inbox = [];
  }

  enqueue(message: Message): void {
    this.inbox.push(message);
  }

  dequeue(): Message | undefined {
    return this.inbox.shift();
  }
}
