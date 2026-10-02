import type { Message } from "./types.js";
export class AProc {
  readonly id: number;
  active = true;
  inMis = false;
  blocked = false;
  marked = false;
  inbox: Message[] = [];
  constructor(id: number) { this.id = id; }
}
