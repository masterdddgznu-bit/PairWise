import type { Message, ProcState } from "./types.js";
import type { Token } from "./token.js";

export class SProc {
  readonly id: number;
  online = true;
  state: ProcState = "idle";
  rn: number[];
  token: Token | null = null;
  inbox: Message[] = [];

  constructor(id: number, n: number) {
    this.id = id;
    this.rn = Array(n).fill(0);
  }
}
