import { VirtualClock } from "./clock.js";
import { InvalidReplicaError, InvalidValueError, NotDoneError } from "./errors.js";
import { Op } from "./op.js";
import { hasQuorum, majorityOf } from "./quorum.js";
import { Replica } from "./replica.js";
import { cmpTs, maxTs } from "./timestamp.js";
import type { OpStatus, ReplicaStore, Timestamp } from "./types.js";

export type AbdRegOptions = {
  clock: VirtualClock;
  replicaCount?: number;
};

export class AbdReg {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly replicas: Replica[] = [];
  private readonly ops = new Map<string, Op>();
  private writeCount = 0;
  private readCount = 0;
  private cursor = 0;

  constructor(opts: AbdRegOptions) {
    this.clock = opts.clock;
    const n = opts.replicaCount ?? 3;
    if (!Number.isInteger(n) || n <= 0) {
      throw new InvalidReplicaError(n);
    }
    this.n = n;
    for (let id = 0; id < n; id++) {
      this.replicas.push(new Replica(id));
    }
  }

  beginWrite(writerId: number, value: string): string {
    if (!this.isValidReplica(writerId)) {
      throw new InvalidReplicaError(writerId);
    }
    if (value === "") {
      throw new InvalidValueError();
    }
    this.writeCount += 1;
    const opId = `w${this.writeCount}`;
    this.ops.set(opId, Op.write(opId, writerId, value));
    return opId;
  }

  beginRead(): string {
    this.readCount += 1;
    const opId = `r${this.readCount}`;
    this.ops.set(opId, Op.read(opId));
    return opId;
  }

  step(): boolean {
    const ops = [...this.ops.values()];
    const count = ops.length;
    for (let i = 0; i < count; i++) {
      const op = ops[(this.cursor + i) % count];
      if (op.status !== "pending") {
        continue;
      }
      this.cursor = (this.cursor + i + 1) % count;
      this.advance(op);
      return true;
    }
    if (count > 0) {
      this.cursor = 0;
    }
    return false;
  }

  pump(): void {
    while (this.step()) {
      // keep advancing pending operations until no progress is possible
    }
  }

  status(opId: string): OpStatus {
    const op = this.ops.get(opId);
    return op === undefined ? "unknown" : op.status;
  }

  result(opId: string): string | null {
    const op = this.ops.get(opId);
    if (op === undefined || op.status !== "done") {
      throw new NotDoneError(opId);
    }
    return op.resultValue;
  }

  local(id: number): ReplicaStore {
    if (!this.isValidReplica(id)) {
      throw new InvalidReplicaError(id);
    }
    return this.replicas[id].store();
  }

  setOnline(id: number, online: boolean): void {
    if (!this.isValidReplica(id)) {
      throw new InvalidReplicaError(id);
    }
    this.replicas[id].online = online;
    for (const op of this.ops.values()) {
      if (op.status === "blocked") {
        op.status = "pending";
      }
    }
  }

  private advance(op: Op): void {
    if (op.phase === "query") {
      const stores = this.queryOnline();
      if (!hasQuorum(stores.length, this.n)) {
        op.status = "blocked";
        return;
      }
      if (op.kind === "write") {
        const maxTsSeen = stores.reduce<Timestamp>(
          (max, s) => maxTs(max, s.ts),
          { num: 0, writerId: 0 },
        );
        op.chosenTs = { num: maxTsSeen.num + 1, writerId: op.writerId };
        op.phase = "write";
      } else {
        const best = stores.reduce((a, b) => (cmpTs(b.ts, a.ts) > 0 ? b : a));
        op.value = best.value;
        op.chosenTs = { ...best.ts };
        op.phase = "writeback";
      }
      return;
    }

    const acks = this.writeOnline(op.value, op.chosenTs);
    if (!hasQuorum(acks, this.n)) {
      op.status = "blocked";
      return;
    }
    op.resultValue = op.value;
    op.status = "done";
  }

  private queryOnline(): ReplicaStore[] {
    const replies: ReplicaStore[] = [];
    for (const replica of this.replicas) {
      if (replica.online) {
        replies.push(replica.store());
        this.clock.advance(1);
      }
    }
    return replies;
  }

  private writeOnline(value: string | null, ts: Timestamp): number {
    let acks = 0;
    for (const replica of this.replicas) {
      if (replica.online) {
        replica.apply(value, ts);
        acks += 1;
        this.clock.advance(1);
      }
    }
    return acks;
  }

  private isValidReplica(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < this.n;
  }
}
