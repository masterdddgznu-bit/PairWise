import type { Message } from "./types.js";

export class YProc {
  readonly id: number;
  online = true;
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }
}
