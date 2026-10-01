import { VirtualClock } from "./clock.js";
import { DProc } from "./process.js";
import { defaultEdges, buildNeighbors, isConnected } from "./graph.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
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
  private readonly procs: DProc[];
  private started = false;
  private isTerminated = false;
  private msgCounter = 0;

  constructor(opts: DSTermOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 5;
    const root = opts.rootId ?? 0;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    if (!Number.isInteger(root) || root < 0 || root >= n) {
      throw new InvalidConfigError(`invalid rootId: ${root}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    for (const [a, b] of edges) {
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n || a === b) {
        throw new InvalidConfigError(`invalid edge: [${a}, ${b}]`);
      }
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    this.n = n;
    this.root = root;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, id) => new DProc(id));
  }

  reset(): void {
    for (const p of this.procs) p.reset();
    this.started = false;
    this.isTerminated = false;
    this.msgCounter = 0;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.started = true;
    const rootProc = this.procs[this.root];
    rootProc.engaged = true;
    rootProc.parent = null;
    rootProc.deficit = 0;
    rootProc.active = true;
  }

  send(from: number, to: number): void {
    this.checkId(from);
    this.checkId(to);
    const src = this.procs[from];
    if (!src.engaged) throw new BusyError(`process ${from} is not engaged`);
    if (!this.neighbors[from].includes(to)) {
      throw new InvalidConfigError(`process ${to} is not a neighbor of ${from}`);
    }
    src.deficit += 1;
    const msg: Message = { kind: "MSG", from, msgId: this.nextMsgId() };
    this.procs[to].inbox.push(msg);
  }

  step(id: number): boolean {
    this.checkId(id);
    const proc = this.procs[id];
    const msg = proc.inbox.shift();
    if (msg === undefined) return false;
    if (msg.kind === "MSG") {
      if (!proc.engaged) {
        proc.engaged = true;
        proc.parent = msg.from;
        proc.active = true;
      } else {
        proc.active = true;
        this.procs[msg.from].inbox.push({ kind: "ACK", from: id, msgId: msg.msgId });
      }
    } else {
      if (proc.deficit === 0) {
        throw new InvalidConfigError(`process ${id} received ACK with deficit 0`);
      }
      proc.deficit -= 1;
      this.tryDissolve(id);
    }
    return true;
  }

  pump(maxSteps?: number): void {
    let steps = 0;
    for (;;) {
      let progressed = false;
      for (const proc of this.procs) {
        while (proc.inbox.length > 0) {
          if (maxSteps !== undefined && steps >= maxSteps) return;
          this.step(proc.id);
          steps += 1;
          progressed = true;
        }
      }
      if (!progressed) return;
    }
  }

  localDone(id: number): void {
    this.checkId(id);
    const proc = this.procs[id];
    if (!proc.engaged) throw new BusyError(`process ${id} is not engaged`);
    proc.active = false;
    this.tryDissolve(id);
  }

  terminated(): boolean {
    return this.isTerminated;
  }

  isEngaged(id: number): boolean {
    this.checkId(id);
    return this.procs[id].engaged;
  }

  isActive(id: number): boolean {
    this.checkId(id);
    return this.procs[id].active;
  }

  parentOf(id: number): number | null {
    this.checkId(id);
    return this.procs[id].parent;
  }

  deficitOf(id: number): number {
    this.checkId(id);
    return this.procs[id].deficit;
  }

  rootId(): number {
    return this.root;
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  private tryDissolve(id: number): void {
    const proc = this.procs[id];
    if (!proc.engaged || proc.active || proc.deficit !== 0) return;
    if (proc.parent !== null) {
      const parent = proc.parent;
      proc.engaged = false;
      proc.parent = null;
      this.procs[parent].inbox.push({ kind: "ACK", from: id, msgId: this.nextMsgId() });
    } else {
      this.isTerminated = true;
    }
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return `m${this.msgCounter}@${this.clock.now()}`;
  }
}
