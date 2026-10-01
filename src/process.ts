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
  preparedP: ProposeVal | null = null;
  rBits = 0;
  rCount = 0;
  pBits = 0;
  pCount = 0;
  pUnknown = 0;

  constructor(id: number) { this.id = id; }

  resetRound(): void {
    this.sentR = false;
    this.sentP = false;
    this.preparedP = null;
    this.rBits = 0;
    this.rCount = 0;
    this.pBits = 0;
    this.pCount = 0;
    this.pUnknown = 0;
  }

  addR(value: Bit): void {
    this.rCount += 1;
    if (value === 1) this.rBits += 1;
  }

  addP(value: ProposeVal): void {
    this.pCount += 1;
    if (value === 1) this.pBits += 1;
    else if (value === "?") this.pUnknown += 1;
  }
}
