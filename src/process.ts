import type { Message } from "./types.js";
export class MProc {
  readonly id: number;
  inbox: Message[] = [];
  active = false;
  black = false;
  delta = 0;
  vc: number[] = [];
  constructor(id: number, size = 0) {
    this.id = id;
    this.vc = new Array<number>(size).fill(0);
  }
}
