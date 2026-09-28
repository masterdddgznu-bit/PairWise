import type { OpKind, OpPhase, OpStatus, Timestamp } from "./types.js";

export class Op {
  readonly id: string;
  readonly kind: OpKind;
  status: OpStatus = "pending";
  phase: OpPhase = "query";
  writerId = 0;
  value: string | null = null;
  resultValue: string | null = null;
  chosenTs: Timestamp = { num: 0, writerId: 0 };

  constructor(id: string, kind: OpKind) {
    this.id = id;
    this.kind = kind;
  }

  static write(id: string, writerId: number, value: string): Op {
    const op = new Op(id, "write");
    op.writerId = writerId;
    op.value = value;
    return op;
  }

  static read(id: string): Op {
    return new Op(id, "read");
  }
}
