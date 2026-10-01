import type { Message } from "./types.js";
export class GProc {
  readonly id: number;
  inbox: Message[] = [];
  constructor(id: number) { this.id = id; }
}
