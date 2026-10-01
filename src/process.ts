import type { Bit, Message } from "./types.js";

export interface ProposalBag {
  zero: number;
  one: number;
}

export interface MajorityInfo {
  value: Bit;
  mult: number;
}

export class PKProc {
  readonly id: number;
  inbox: Message[] = [];
  pref: Bit = 0;
  phase = 0;
  decided = false;
  sentPropose = false;
  sentKing = false;
  readonly proposals = new Map<number, ProposalBag>();
  readonly majorities = new Map<number, MajorityInfo>();
  readonly kingValues = new Map<number, Bit>();
  constructor(id: number) { this.id = id; }
}
