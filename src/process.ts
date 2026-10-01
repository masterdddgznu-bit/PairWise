import type { Message } from "./types.js";

export class DProc {
  readonly id: number;
  inbox: Message[] = [];
  engaged = false;
  active = false;
  parent: number | null = null;
  deficit = 0;
  constructor(id: number) { this.id = id; }

  reset(): void {
    this.inbox = [];
    this.engaged = false;
    this.active = false;
    this.parent = null;
    this.deficit = 0;
  }
}
