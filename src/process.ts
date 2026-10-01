import type { Message } from "./types.js";

export class DProc {
  readonly id: number;
  inbox: Message[] = [];
  engaged = false;
  active = false;
  parent: number | null = null;
  deficit = 0;
  parentMsgId: string | null = null;
  constructor(id: number) { this.id = id; }
}
