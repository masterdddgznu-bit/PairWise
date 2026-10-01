import type { Bit, Message } from "./types.js";
export class PKProc {
  readonly id: number;
  inbox: Message[] = [];
  pref: Bit = 0;
  phase = 0;
  decided = false;
  constructor(id: number) { this.id = id; }
}
