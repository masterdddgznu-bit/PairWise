import type { Message } from "./types.js";

export class FProc {
  readonly id: number;
  readonly uid: number;
  online = true;
  maxKnown: number;
  inbox: Message[] = [];

  constructor(id: number, uid: number) {
    this.id = id;
    this.uid = uid;
    this.maxKnown = uid;
  }
}
