import type { Bit, Message, ProposeVal } from "./types.js";
export class BOProc {
  readonly id: number;
  inbox: Message[] = [];
  est: Bit = 0;
  round = 1;
  decided = false;
  constructor(id: number) { this.id = id; }
}
