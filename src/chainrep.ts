import { VirtualClock } from "./clock.js";
import { Replica } from "./replica.js";
import { WriteOp } from "./op.js";
import { activeChain } from "./chain.js";
import {
  InvalidReplicaError,
  InvalidValueError,
  NoQuorumError,
  NotDoneError,
} from "./errors.js";
import type { LocalView, OpStatus } from "./types.js";

export type ChainRepOptions = {
  clock: VirtualClock;
  replicaCount?: number;
};

export class ChainRep {
  readonly clock: VirtualClock;
  private readonly replicas: Replica[];
  private readonly ops = new Map<string, WriteOp>();
  private seqCounter = 0;
  private opCounter = 0;

  constructor(opts: ChainRepOptions) {
    this.clock = opts.clock;
    const count = opts.replicaCount ?? 4;
    this.replicas = Array.from({ length: count }, (_, i) => new Replica(i));
  }

  beginWrite(value: string): string {
    if (value === "") throw new InvalidValueError();
    const chain = activeChain(this.replicas);
    const headId = chain[0];
    if (headId === undefined) throw new NoQuorumError();
    const seq = ++this.seqCounter;
    const opId = `w${++this.opCounter}`;
    this.replicas[headId].accept(seq, value);
    this.ops.set(opId, new WriteOp(opId, seq, value, headId));
    return opId;
  }

  step(): boolean {
    let progress = false;
    const chain = activeChain(this.replicas);
    for (const op of this.ops.values()) {
      if (op.status === "done") continue;
      const idx = chain.indexOf(op.holderId);
      if (idx === -1) {
        op.status = "blocked";
        continue;
      }
      if (idx === chain.length - 1) {
        this.replicas[op.holderId].accept(op.seq, op.value);
        op.status = "done";
        progress = true;
      } else {
        const next = this.replicas[chain[idx + 1]];
        next.accept(op.seq, op.value);
        op.holderId = next.id;
        op.status = "pending";
        progress = true;
      }
    }
    return progress;
  }

  pump(): void {
    while (this.step()) {
      // advance until no further progress
    }
  }

  status(opId: string): OpStatus {
    return this.ops.get(opId)?.status ?? "unknown";
  }

  result(opId: string): string {
    const op = this.ops.get(opId);
    if (!op || op.status !== "done") throw new NotDoneError(opId);
    return op.value;
  }

  read(): string | null {
    const chain = activeChain(this.replicas);
    const tailId = chain[chain.length - 1];
    if (tailId === undefined) throw new NoQuorumError();
    return this.replicas[tailId].value;
  }

  headId(): number | null {
    return activeChain(this.replicas)[0] ?? null;
  }

  tailId(): number | null {
    const chain = activeChain(this.replicas);
    return chain.length === 0 ? null : chain[chain.length - 1];
  }

  chain(): number[] {
    return activeChain(this.replicas);
  }

  local(id: number): LocalView {
    const r = this.replica(id);
    return { value: r.value, seq: r.seq, online: r.online };
  }

  setOnline(id: number, online: boolean): void {
    this.replica(id).online = online;
    const chain = activeChain(this.replicas);
    for (const op of this.ops.values()) {
      if (op.status === "done") continue;
      op.status = "pending";
      if (chain.length === 0) continue;
      const holderId = chain.find(
        (cid) => this.replicas[cid].seq === op.seq,
      );
      if (holderId !== undefined) {
        op.holderId = holderId;
      } else {
        const head = this.replicas[chain[0]];
        head.accept(op.seq, op.value);
        op.holderId = head.id;
      }
    }
  }

  private replica(id: number): Replica {
    const r = this.replicas[id];
    if (!r) throw new InvalidReplicaError(id);
    return r;
  }
}
