import type { Message } from "./types.js";

export class AProc {
  readonly id: number;
  online = true;
  pulse = 0;
  emitted = false;
  recv = new Set<number>();
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }
}
