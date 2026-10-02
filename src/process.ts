import type { Message } from "./types.js";
export class MProc {
  readonly id: number;
  inbox: Message[] = [];
  free = true;
  mate: number | null = null;
  constructor(id: number) { this.id = id; }
}
