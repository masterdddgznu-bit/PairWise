import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { buildNeighbors, defaultEdges, isConnected } from "./graph.js";
import { DProc } from "./process.js";
import type { Message } from "./types.js";

export type DSTermOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  rootId?: number;
};

export class DSTerm {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly root: number;
  private readonly neighbors: number[][];
  private procs: DProc[];
  private started = false;
  private isTerminated = false;
  private msgSeq = 0;

  constructor(opts: DSTermOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const root = opts.rootId ?? 0;
    if (!Number.isInteger(root) || root < 0 || root >= n) {
      throw new InvalidConfigError(`invalid rootId: ${root}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    this.n = n;
    this.root = root;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = this.freshProcs();
  }

  private freshProcs(): DProc[] {
    const procs: DProc[] = [];
    for (let i = 0; i < this.n; i++) {
      procs.push(new DProc(i));
    }
    return procs;
  }

  private proc(id: number): DProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    this.msgSeq += 1;
    return `m${this.msgSeq}@${this.clock.now()}`;
  }

  private deliver(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
  }

  reset(): void {
    this.procs = this.freshProcs();
    this.started = false;
    this.isTerminated = false;
    this.msgSeq = 0;
  }

  start(): void {
    if (this.started) {
      throw new BusyError("computation already started");
    }
    this.started = true;
    const root = this.procs[this.root];
    root.engaged = true;
    root.parent = null;
    root.deficit = 0;
    root.active = true;
  }

  send(from: number, to: number): void {
    const src = this.proc(from);
    this.proc(to);
    if (!src.engaged) {
      throw new BusyError(`process ${from} is not engaged`);
    }
    if (!this.neighbors[from].includes(to)) {
      throw new InvalidConfigError(`process ${to} is not a neighbor of ${from}`);
    }
    src.deficit += 1;
    this.deliver(to, { kind: "MSG", from, msgId: this.nextMsgId() });
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    if (msg.kind === "MSG") {
      if (!p.engaged) {
        p.engaged = true;
        p.parent = msg.from;
        p.active = true;
        p.parentMsgId = msg.msgId;
      } else {
        p.active = true;
        this.deliver(msg.from, { kind: "ACK", from: id, msgId: msg.msgId });
      }
    } else {
      if (p.deficit <= 0) {
        throw new InvalidConfigError(`process ${id} received ACK with zero deficit`);
      }
      p.deficit -= 1;
      this.tryDissolve(id);
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.proc(to);
      while (this.step(to)) {
        // drain this process's inbox
      }
      return;
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        if (p.inbox.length > 0) {
          this.step(p.id);
          progress = true;
        }
      }
    }
  }

  localDone(id: number): void {
    const p = this.proc(id);
    if (!p.engaged) {
      throw new BusyError(`process ${id} is not engaged`);
    }
    p.active = false;
    this.tryDissolve(id);
  }

  private tryDissolve(id: number): void {
    const p = this.procs[id];
    if (!p.engaged || p.active || p.deficit !== 0) {
      return;
    }
    if (p.parent !== null) {
      const ack: Message = {
        kind: "ACK",
        from: id,
        msgId: p.parentMsgId ?? this.nextMsgId(),
      };
      this.deliver(p.parent, ack);
      p.engaged = false;
      p.parent = null;
      p.parentMsgId = null;
    } else {
      this.isTerminated = true;
    }
  }

  terminated(): boolean { return this.isTerminated; }
  isEngaged(id: number): boolean { return this.proc(id).engaged; }
  isActive(id: number): boolean { return this.proc(id).active; }
  parentOf(id: number): number | null { return this.proc(id).parent; }
  deficitOf(id: number): number { return this.proc(id).deficit; }
  rootId(): number { return this.root; }
  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.neighbors[id]];
  }
  inboxSize(id: number): number { return this.proc(id).inbox.length; }
}
