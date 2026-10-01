import type { Bit, Message } from "./types.js";

export class PKProc {
  readonly id: number;
  inbox: Message[] = [];
  deferred: Message[] = [];
  pref: Bit = 0;
  phase = 0;
  decided = false;
  sentPropose = false;
  sentKing = false;
  gotKing = false;
  kingValue: Bit = 0;
  counts: [number, number] = [0, 0];

  constructor(id: number) { this.id = id; }

  resetPhaseState(): void {
    this.sentPropose = false;
    this.sentKing = false;
    this.gotKing = false;
    this.kingValue = 0;
    this.counts = [0, 0];
  }

  resetAll(pref: Bit): void {
    this.inbox = [];
    this.deferred = [];
    this.pref = pref;
    this.phase = 0;
    this.decided = false;
    this.resetPhaseState();
  }
}
