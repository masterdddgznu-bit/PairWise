import type { Bit, Message, ProposeVal } from "./types.js";
export class BOProc {
  readonly id: number;
  inbox: Message[] = [];
  est: Bit = 0;
  round = 1;
  decided = false;
  decision: Bit | null = null;
  sentR = false;
  sentP = false;
  rCounts: [number, number] = [0, 0];
  pCounts: [number, number] = [0, 0];
  rTotal = 0;
  pTotal = 0;
  pendingP: ProposeVal | null = null;
  pEvaluated = false;
  constructor(id: number) { this.id = id; }

  beginNextRound(): void {
    this.round += 1;
    this.sentR = false;
    this.sentP = false;
    this.rCounts = [0, 0];
    this.pCounts = [0, 0];
    this.rTotal = 0;
    this.pTotal = 0;
    this.pendingP = null;
    this.pEvaluated = false;
  }
}
