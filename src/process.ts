import type { Message } from "./types.js";
export class LProc {
  readonly id: number;
  inbox: Message[] = [];
  active = true;
  inMis = false;
  rank: number | null = null;
  peerRanks = new Map<number, number>();
  constructor(id: number) { this.id = id; }
}
