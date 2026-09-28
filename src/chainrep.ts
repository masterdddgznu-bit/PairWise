import { VirtualClock } from "./clock.js";
import { activeChain } from "./chain.js";
import {
  InvalidReplicaError,
  InvalidValueError,
  NoQuorumError,
  NotDoneError,
} from "./errors.js";
import { WriteOp } from "./op.js";
import { Replica } from "./replica.js";
import type { LocalView, OpStatus } from "./types.js";

export type ChainRepOptions = {
  clock: VirtualClock;
  replicaCount?: number;
};

export class ChainRep {
  readonly clock: VirtualClock;

  private readonly replicas: Replica[];
  private readonly ops = new Map<string, WriteOp>();
  private nextSeq = 0;

  constructor(opts: ChainRepOptions) {
    this.clock = opts.clock;
    const count = opts.replicaCount ?? 4;
    this.replicas = Array.from({ length: count }, (_, id) => new Replica(id));
  }

  beginWrite(value: string): string {
    if (value === "") {
      throw new InvalidValueError();
    }
    const chain = activeChain(this.replicas);
    const headId = chain[0];
    if (headId === undefined) {
      throw new NoQuorumError();
    }
    this.nextSeq += 1;
    const seq = this.nextSeq;
    const opId = `w${seq}`;
    const head = this.replicas[headId];
    head.value = value;
    head.seq = seq;
    const op = new WriteOp(opId, seq, value, headId);
    this.ops.set(opId, op);
    return opId;
  }

  step(): boolean {
    let progressed = false;
    const chain = activeChain(this.replicas);
    for (const op of this.ops.values()) {
      if (op.status !== "pending" && op.status !== "blocked") {
        continue;
      }
      if (!this.replicas[op.holderId].online) {
        if (op.status !== "blocked") {
          op.status = "blocked";
          progressed = true;
        }
        continue;
      }
      const position = chain.indexOf(op.holderId);
      if (position === -1) {
        if (op.status !== "blocked") {
          op.status = "blocked";
          progressed = true;
        }
        continue;
      }
      if (op.status === "blocked") {
        op.status = "pending";
        progressed = true;
      }
      const nextId = chain[position + 1];
      if (nextId === undefined) {
        op.status = "done";
        progressed = true;
      } else {
        const next = this.replicas[nextId];
        next.value = op.value;
        next.seq = op.seq;
        op.holderId = nextId;
        progressed = true;
      }
    }
    return progressed;
  }

  pump(): void {
    while (this.step()) {
      // keep advancing until every unfinished write is blocked or done
    }
  }

  status(opId: string): OpStatus {
    const op = this.ops.get(opId);
    return op === undefined ? "unknown" : op.status;
  }

  result(opId: string): string {
    const op = this.ops.get(opId);
    if (op === undefined || op.status !== "done") {
      throw new NotDoneError(opId);
    }
    return op.value;
  }

  read(): string | null {
    const chain = activeChain(this.replicas);
    const tailId = chain[chain.length - 1];
    if (tailId === undefined) {
      throw new NoQuorumError();
    }
    return this.replicas[tailId].value;
  }

  headId(): number | null {
    const chain = activeChain(this.replicas);
    return chain[0] ?? null;
  }

  tailId(): number | null {
    const chain = activeChain(this.replicas);
    return chain[chain.length - 1] ?? null;
  }

  chain(): number[] {
    return activeChain(this.replicas);
  }

  local(id: number): LocalView {
    const replica = this.replicas[id];
    if (replica === undefined) {
      throw new InvalidReplicaError(id);
    }
    return { value: replica.value, seq: replica.seq, online: replica.online };
  }

  setOnline(id: number, online: boolean): void {
    const replica = this.replicas[id];
    if (replica === undefined) {
      throw new InvalidReplicaError(id);
    }
    replica.online = online;
    const chain = activeChain(this.replicas);
    if (chain.length === 0) {
      for (const op of this.ops.values()) {
        if (op.status === "blocked") {
          op.status = "pending";
        }
      }
      return;
    }
    const headId = chain[0];
    for (const op of this.ops.values()) {
      if (op.status === "done") {
        continue;
      }
      if (op.status === "blocked") {
        op.status = "pending";
      }
      let recovered: number | undefined;
      for (const nodeId of chain) {
        const node = this.replicas[nodeId];
        if (node.seq === op.seq && node.value === op.value) {
          recovered = nodeId;
          break;
        }
      }
      if (recovered === undefined) {
        const head = this.replicas[headId];
        head.value = op.value;
        head.seq = op.seq;
        recovered = headId;
      }
      op.holderId = recovered;
    }
  }
}
