import type { Message } from "./types.js";

export class YProc {
  readonly id: number;
  online = true;
  inbox: Message[] = [];

  downExpected = new Set<number>();
  upExpected = new Set<number>();
  downRecv = new Map<number, number>();
  upRecv = new Map<number, boolean>();
  cand = 0;
  done = true;

  constructor(id: number) {
    this.id = id;
  }

  beginRound(ins: number[], outs: number[]): void {
    this.downExpected = new Set(ins);
    this.upExpected = new Set(outs);
    this.downRecv = new Map();
    this.upRecv = new Map();
    this.cand = 0;
    this.done = false;
  }

  reset(): void {
    this.online = true;
    this.inbox = [];
    this.downExpected = new Set();
    this.upExpected = new Set();
    this.downRecv = new Map();
    this.upRecv = new Map();
    this.cand = 0;
    this.done = true;
  }
}
