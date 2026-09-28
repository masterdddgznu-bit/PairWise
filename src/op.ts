import type { OpStatus } from "./types.js";

export class WriteOp {
  readonly id: string;
  readonly seq: number;
  readonly value: string;
  status: OpStatus = "pending";
  holderId: number;
  constructor(id: string, seq: number, value: string, holderId: number) {
    this.id = id;
    this.seq = seq;
    this.value = value;
    this.holderId = holderId;
  }
}
