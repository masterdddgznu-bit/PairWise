import type { Message } from "./types.js";

export class BProc {
  readonly id: number;
  online = true;
  pulse = 0;
  upSent = false;
  upRecv = new Set<number>();
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }
}
