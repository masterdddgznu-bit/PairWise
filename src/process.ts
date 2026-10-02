import type { Message } from "./types.js";
export class CProc {
  readonly id: number;
  color = 0;
  predColor = 0;
  inbox: Message[] = [];
  constructor(id: number) { this.id = id; }
}
