import type { Message } from "./types.js";
export class WProc {
  readonly id: number;
  inbox: Message[] = [];
  active = false;
  weight = 0;
  constructor(id: number) { this.id = id; }
}
