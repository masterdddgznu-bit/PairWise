import type { Message, ProcState } from "./types.js";

export class RProc {
  readonly id: number;
  online = true;
  state: ProcState = "idle";
  parent: number;
  queue: number[] = [];
  inbox: Message[] = [];

  constructor(id: number, parent: number) {
    this.id = id;
    this.parent = parent;
  }

  enqueueRequester(id: number): void {
    if (!this.queue.includes(id)) {
      this.queue.push(id);
    }
  }

  shiftQueue(): number | undefined {
    return this.queue.shift();
  }

  popInbox(): Message | undefined {
    return this.inbox.shift();
  }
}
