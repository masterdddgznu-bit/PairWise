import type { Message } from "./types.js";

export type RoundPhase = "idle" | "down" | "up";

export class YProc {
  readonly id: number;
  online = true;
  inbox: Message[] = [];
  phase: RoundPhase = "idle";
  inExpect: number[] = [];
  outExpect: number[] = [];
  downRecv = new Map<number, number>();
  upRecv = new Map<number, boolean>();

  constructor(id: number) {
    this.id = id;
  }

  reset(): void {
    this.online = true;
    this.inbox = [];
    this.phase = "idle";
    this.inExpect = [];
    this.outExpect = [];
    this.downRecv.clear();
    this.upRecv.clear();
  }
}
