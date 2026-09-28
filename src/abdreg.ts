import { VirtualClock } from "./clock.js";
import { Op } from "./op.js";
import { Replica } from "./replica.js";
import { InvalidReplicaError, InvalidValueError, NotDoneError } from "./errors.js";
import { hasQuorum } from "./quorum.js";
import { maxTs } from "./timestamp.js";
import type { OpStatus, ReplicaStore, Timestamp } from "./types.js";

export type AbdRegOptions = {
  clock: VirtualClock;
  replicaCount?: number;
};

export class AbdReg {
  readonly clock: VirtualClock;
  private readonly replicas: Replica[];
  private readonly ops = new Map<string, Op>();
  private writeSeq = 0;
  private readSeq = 0;

  constructor(opts: AbdRegOptions) {
    this.clock = opts.clock;
    const n = opts.replicaCount ?? 3;
    this.replicas = [];
    for (let i = 0; i < n; i++) this.replicas.push(new Replica(i));
  }

  private replica(id: number): Replica {
    const r = this.replicas[id];
    if (!r) throw new InvalidReplicaError(id);
    return r;
  }

  beginWrite(writerId: number, value: string): string {
    this.replica(writerId);
    if (value === "") throw new InvalidValueError();
    const op = new Op(`w${++this.writeSeq}`, "write");
    op.writerId = writerId;
    op.value = value;
    this.ops.set(op.id, op);
    return op.id;
  }

  beginRead(): string {
    const op = new Op(`r${++this.readSeq}`, "read");
    this.ops.set(op.id, op);
    return op.id;
  }

  private onlineReplicas(): Replica[] {
    return this.replicas.filter((r) => r.online);
  }

  private quorumQuery(): ReplicaStore[] | null {
    const stores = this.onlineReplicas().map((r) => r.store());
    return hasQuorum(stores.length, this.replicas.length) ? stores : null;
  }

  private quorumApply(value: string | null, ts: Timestamp): boolean {
    const online = this.onlineReplicas();
    if (!hasQuorum(online.length, this.replicas.length)) return false;
    for (const r of online) r.apply(value, ts);
    return true;
  }

  private stepOp(op: Op): void {
    if (op.phase === "query") {
      const stores = this.quorumQuery();
      if (!stores) {
        op.status = "blocked";
        return;
      }
      let max = stores[0];
      for (const s of stores) {
        if (maxTs(s.ts, max.ts) === s.ts) max = s;
      }
      if (op.kind === "write") {
        op.chosenTs = { num: max.ts.num + 1, writerId: op.writerId };
        op.phase = "write";
      } else {
        op.chosenTs = { ...max.ts };
        op.resultValue = max.value;
        op.phase = "writeback";
      }
      return;
    }
    // write or writeback phase
    const value = op.kind === "write" ? op.value : op.resultValue;
    if (!this.quorumApply(value, op.chosenTs)) {
      op.status = "blocked";
      return;
    }
    if (op.kind === "write") op.resultValue = op.value;
    op.status = "done";
  }

  step(): boolean {
    let progressed = false;
    for (const op of this.ops.values()) {
      if (op.status !== "pending") continue;
      this.stepOp(op);
      this.clock.advance(1);
      progressed = true;
    }
    return progressed;
  }

  pump(): void {
    while (this.step()) {
      /* keep stepping */
    }
  }

  status(opId: string): OpStatus {
    return this.ops.get(opId)?.status ?? "unknown";
  }

  result(opId: string): string | null {
    const op = this.ops.get(opId);
    if (!op || op.status !== "done") throw new NotDoneError(opId);
    return op.resultValue;
  }

  local(id: number): ReplicaStore {
    return this.replica(id).store();
  }

  setOnline(id: number, online: boolean): void {
    this.replica(id).online = online;
    for (const op of this.ops.values()) {
      if (op.status === "blocked") op.status = "pending";
    }
  }
}
