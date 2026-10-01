import type { Color, Message } from "./types.js";
export class SProc {
  readonly id: number;
  inbox: Message[] = [];
  active = false;
  color: Color = "white";
  count = 0;
  constructor(id: number) { this.id = id; }
}
