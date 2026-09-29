import type { Message } from "./types.js";

export class HProc {
  readonly id: number;
  readonly uid: number;
  online = true;
  participant = false;
  phase = 0;
  replies = 0;
  leader: number | null = null;
  inbox: Message[] = [];

  constructor(id: number, uid: number) {
    this.id = id;
    this.uid = uid;
  }
}
