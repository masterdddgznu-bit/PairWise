import type { Message } from "./types.js";

export class TProc {
  readonly id: number;
  online = true;
  visited = false;
  parent: number | null = null;
  used = new Set<number>();
  inbox: Message[] = [];
  decided = false;

  constructor(id: number) {
    this.id = id;
  }

  reset(): void {
    this.visited = false;
    this.parent = null;
    this.used.clear();
    this.inbox = [];
    this.decided = false;
  }
}
