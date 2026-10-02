import type { Message } from "./types.js";
export class CProc {
  readonly id: number;
  color = 0;
  inbox: Message[] = [];
  predColor: number | null = null;
  constructor(id: number) { this.id = id; }
}
