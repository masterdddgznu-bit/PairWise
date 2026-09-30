import type { Message } from "./types.js";

export class TProc {
  readonly id: number;
  online = true;
  visited = false;
  parent: number | null = null;
  used = new Set<number>();
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }

  /** Reset traversal-local state (online status is preserved). */
  resetTraversal(): void {
    this.visited = false;
    this.parent = null;
    this.used.clear();
    this.inbox.length = 0;
  }

  enqueue(message: Message): void {
    this.inbox.push(message);
  }

  dequeue(): Message | undefined {
    return this.inbox.shift();
  }
}
