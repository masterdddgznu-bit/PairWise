import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { buildNeighbors, defaultEdges, isConnected, isPowerOfTwo } from "./graph.js";
import { WProc } from "./process.js";

export type WThrowOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  rootId?: number;
  totalWeight?: number;
};

export class WThrow {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly root: number;
  private readonly total: number;
  private readonly neighbors: number[][];
  private readonly procs: WProc[];
  private started = false;
  private terminatedFlag = false;
  private msgCounter = 0;

  constructor(opts: WThrowOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 5;
    const root = opts.rootId ?? 0;
    const total = opts.totalWeight ?? 64;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    if (!Number.isInteger(root) || root < 0 || root >= n) {
      throw new InvalidConfigError(`rootId out of range: ${root}`);
    }
    if (!isPowerOfTwo(total) || total < 2) {
      throw new InvalidConfigError(`totalWeight must be a power of two >= 2, got ${total}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    for (const edge of edges) {
      if (
        !Array.isArray(edge) ||
        edge.length !== 2 ||
        !Number.isInteger(edge[0]) ||
        !Number.isInteger(edge[1]) ||
        edge[0] < 0 ||
        edge[1] < 0 ||
        edge[0] >= n ||
        edge[1] >= n ||
        edge[0] === edge[1]
      ) {
        throw new InvalidConfigError(`invalid edge: ${JSON.stringify(edge)}`);
      }
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    this.n = n;
    this.root = root;
    this.total = total;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, id) => new WProc(id));
  }

  reset(): void {
    for (const p of this.procs) {
      p.inbox.length = 0;
      p.active = false;
      p.weight = 0;
    }
    this.started = false;
    this.terminatedFlag = false;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.started = true;
    const rootProc = this.procs[this.root];
    rootProc.active = true;
    rootProc.weight = this.total;
  }

  send(from: number, to: number): void {
    this.checkId(from);
    this.checkId(to);
    this.checkStarted();
    if (!this.neighbors[from].includes(to)) {
      throw new InvalidConfigError(`${to} is not a neighbor of ${from}`);
    }
    const src = this.procs[from];
    if (!src.active) {
      throw new InvalidConfigError(`process ${from} is not active`);
    }
    if (src.weight < 2) {
      throw new InvalidConfigError(`process ${from} has insufficient weight ${src.weight}`);
    }
    const give = Math.floor(src.weight / 2);
    src.weight -= give;
    this.procs[to].inbox.push({
      kind: "MSG",
      weight: give,
      from,
      msgId: this.nextMsgId(),
    });
  }

  step(id: number): boolean {
    this.checkId(id);
    const proc = this.procs[id];
    const msg = proc.inbox.shift();
    if (msg === undefined) return false;
    if (msg.kind === "MSG") {
      proc.weight += msg.weight;
      proc.active = true;
    } else {
      if (id !== this.root) {
        throw new InvalidConfigError(`non-root process ${id} received RETURN`);
      }
      proc.weight += msg.weight;
      this.tryTerminate();
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.checkId(to);
      while (this.step(to)) {
        // drain inbox of `to`
      }
      return;
    }
    for (let id = 0; id < this.n; id++) {
      while (this.step(id)) {
        // drain inbox of `id`
      }
    }
  }

  localDone(id: number): void {
    this.checkId(id);
    this.checkStarted();
    const proc = this.procs[id];
    proc.active = false;
    if (id !== this.root) {
      if (proc.weight > 0) {
        this.procs[this.root].inbox.push({
          kind: "RETURN",
          weight: proc.weight,
          from: id,
          msgId: this.nextMsgId(),
        });
        proc.weight = 0;
      }
    } else {
      this.tryTerminate();
    }
  }

  terminated(): boolean {
    return this.terminatedFlag;
  }

  isActive(id: number): boolean {
    this.checkId(id);
    return this.procs[id].active;
  }

  weightOf(id: number): number {
    this.checkId(id);
    return this.procs[id].weight;
  }

  totalWeight(): number {
    return this.total;
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

  private tryTerminate(): void {
    const rootProc = this.procs[this.root];
    if (!rootProc.active && rootProc.weight === this.total) {
      this.terminatedFlag = true;
    }
  }

  private checkStarted(): void {
    if (!this.started) throw new BusyError("not started");
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return `m${this.clock.now()}-${this.msgCounter}`;
  }
}
