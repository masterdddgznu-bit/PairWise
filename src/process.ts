import type { CbMessage, Delivered, Vector } from "./types.js";

export class VProc {
  readonly id: number;
  online = true;
  clock: Vector;
  inbox: CbMessage[] = [];
  buffer: CbMessage[] = [];
  delivered: Delivered[] = [];

  constructor(id: number, n: number) {
    this.id = id;
    this.clock = Array(n).fill(0);
  }
}
