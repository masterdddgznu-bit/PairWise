import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { buildNeighbors, defaultEdges, isConnected, isPowerOfTwo } from "./graph.js";
import { WProc } from "./process.js";
import type { Message } from "./types.js";

export type WThrowOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  rootId?: number;
  totalWeight?: number;
};

export class WThrow {
  readonly clock: VirtualClock;
  private readonly procs: WProc[];
  private readonly neighbors: number[][];
  private readonly root: number;
  private readonly total: number;
  private started = false;
  private terminatedFlag = false;
  private msgSeq = 0;

  constructor(opts: WThrowOptions) {
    this.clock = opts.clock;
    const processCount = opts.processCount ?? 5;
    const edges = opts.edges ?? defaultEdges(processCount);
    const rootId = opts.rootId ?? 0;
    const totalWeight = opts.totalWeight ?? 64;

    if (!Number.isInteger(processCount) || processCount < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${processCount}`);
    }
    if (!Number.isInteger(rootId) || rootId < 0 || rootId >= processCount) {
      throw new InvalidConfigError(`invalid rootId: ${rootId}`);
    }
    if (!Number.isInteger(totalWeight) || totalWeight < 2 || !isPowerOfTwo(totalWeight)) {
      throw new InvalidConfigError(`totalWeight must be a power of two >= 2, got ${totalWeight}`);
    }
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new InvalidConfigError(`malformed edge: ${JSON.stringify(edge)}`);
      }
      const [u, v] = edge;
      if (!Number.isInteger(u) || !Number.isInteger(v) || u === v
        || u < 0 || v < 0 || u >= processCount || v >= processCount) {
        throw new InvalidConfigError(`invalid edge: [${u}, ${v}]`);
      }
    }
    if (!isConnected(processCount, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }

    this.root = rootId;
    this.total = totalWeight;
    this.neighbors = buildNeighbors(processCount, edges);
    this.procs = [];
    for (let i = 0; i < processCount; i += 1) this.procs.push(new WProc(i));
  }

  private checkId(id: number): WProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    this.msgSeq += 1;
    return `m${this.clock.now()}-${this.msgSeq}`;
  }

  private tryTerminate(): void {
    const root = this.procs[this.root];
    if (!root.active && root.weight === this.total) this.terminatedFlag = true;
  }

  reset(): void {
    for (const proc of this.procs) {
      proc.inbox = [];
      proc.active = false;
      proc.weight = 0;
    }
    this.started = false;
    this.terminatedFlag = false;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.started = true;
    this.terminatedFlag = false;
    for (const proc of this.procs) {
      proc.active = false;
      proc.weight = 0;
    }
    const root = this.procs[this.root];
    root.active = true;
    root.weight = this.total;
  }

  send(from: number, to: number): void {
    const src = this.checkId(from);
    this.checkId(to);
    if (!this.started) throw new BusyError("not started");
    if (!src.active) throw new InvalidConfigError(`process ${from} is not active`);
    if (!this.neighbors[from].includes(to)) {
      throw new InvalidConfigError(`process ${to} is not a neighbor of ${from}`);
    }
    if (src.weight < 2) {
      throw new InvalidConfigError(`process ${from} has insufficient weight: ${src.weight}`);
    }
    const give = Math.floor(src.weight / 2);
    src.weight -= give;
    this.procs[to].inbox.push({ kind: "MSG", weight: give, from, msgId: this.nextMsgId() });
  }

  step(id: number): boolean {
    const proc = this.checkId(id);
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
      while (this.step(to)) { /* drain */ }
      return;
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const proc of this.procs) {
        if (this.step(proc.id)) progress = true;
      }
    }
  }

  localDone(id: number): void {
    const proc = this.checkId(id);
    if (!this.started) throw new BusyError("not started");
    proc.active = false;
    if (id !== this.root) {
      if (proc.weight > 0) {
        const returned: Message = {
          kind: "RETURN",
          weight: proc.weight,
          from: id,
          msgId: this.nextMsgId(),
        };
        proc.weight = 0;
        this.procs[this.root].inbox.push(returned);
      }
    } else {
      this.tryTerminate();
    }
  }

  terminated(): boolean { return this.terminatedFlag; }
  isActive(id: number): boolean { return this.checkId(id).active; }
  weightOf(id: number): number { return this.checkId(id).weight; }
  totalWeight(): number { return this.total; }
  rootId(): number { return this.root; }
  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }
  inboxSize(id: number): number { return this.checkId(id).inbox.length; }
}
