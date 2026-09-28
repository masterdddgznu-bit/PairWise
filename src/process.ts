import type { Message, ProcState, WaitItem } from "./types.js";

export class MProc {
  readonly id: number;
  online = true;
  lamport = 0;
  state: ProcState = "idle";
  requestTs: number | null = null;
  granted = new Set<number>();
  votingFor: number | null = null;
  waitQ: WaitItem[] = [];
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }
}
