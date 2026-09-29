import type { Message } from "./types.js";

export class CProc {
  readonly id: number;
  readonly uid: number;
  online = true;
  participant = false;
  leader: number | null = null;
  inbox: Message[] = [];

  constructor(id: number, uid: number) {
    this.id = id;
    this.uid = uid;
  }
}
