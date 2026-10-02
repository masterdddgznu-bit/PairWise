import type { Message } from "./types.js";
export class KProc {
  readonly id: number;
  color = 0;
  inbox: Message[] = [];
  constructor(id: number) { this.id = id; }
}
