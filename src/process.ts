import type { Message } from "./types.js";
export class LProc {
  readonly id: number;
  color = 0;
  inbox: Message[] = [];
  constructor(id: number) { this.id = id; }
}
