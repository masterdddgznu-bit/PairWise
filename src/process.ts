import type { Message, ProcState } from "./types.js";

export class NProc {
  readonly id: number;
  online = true;
  state: ProcState = "idle";
  token = false;
  requesting = false;
  last: number;
  next: number | null = null;
  inbox: Message[] = [];

  constructor(id: number, last: number) {
    this.id = id;
    this.last = last;
  }
}
