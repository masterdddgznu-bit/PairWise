import { VirtualClock } from "./clock.js";
import { BProc } from "./process.js";
import type { Message } from "./types.js";
import { InvalidProcessError, OfflineError, BusyError, InvalidConfigError } from "./errors.js";
import { defaultEdges, buildNeighbors, validateGraph } from "./graph.js";

export type AsyncBfsOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class AsyncBfs {
  readonly clock: VirtualClock;
  private readonly procs: BProc[];
  private readonly neighbors: number[][];
  private readonly n: number;
  private root: number | null = null;

  constructor(opts: AsyncBfsOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError("processCount must be an integer >= 2");
    }
    const edges = opts.edges ?? defaultEdges(n);
    try {
      validateGraph(n, edges);
    } catch (err) {
      throw new InvalidConfigError(err instanceof Error ? err.message : String(err));
    }
    this.n = n;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_unused, id) => new BProc(id));
  }

  private validId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  start(rootId: number): number {
    this.validId(rootId);
    if (!this.procs[rootId].online) {
      throw new OfflineError(rootId);
    }
    if (this.root !== null && !this.converged()) {
      throw new BusyError();
    }
    for (const proc of this.procs) {
      proc.dist = null;
      proc.parent = null;
      proc.inbox = [];
    }
    this.root = rootId;
    const rootProc = this.procs[rootId];
    rootProc.dist = 0;
    rootProc.parent = null;
    let sent = 0;
    for (const neighbor of this.neighbors[rootId]) {
      if (this.procs[neighbor].online) {
        const msg: Message = {
          kind: "PULSE",
          d: 0,
          from: rootId,
          msgId: this.clock.nextMsgId(),
        };
        this.procs[neighbor].inbox.push(msg);
        sent += 1;
      }
    }
    return sent;
  }

  step(id: number): boolean {
    this.validId(id);
    const proc = this.procs[id];
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const msg = proc.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    const cand = msg.d + 1;
    if (proc.dist === null || cand < proc.dist) {
      proc.dist = cand;
      proc.parent = msg.from;
      for (const neighbor of this.neighbors[id]) {
        if (this.procs[neighbor].online) {
          const outgoing: Message = {
            kind: "PULSE",
            d: cand,
            from: id,
            msgId: this.clock.nextMsgId(),
          };
          this.procs[neighbor].inbox.push(outgoing);
        }
      }
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.validId(to);
      while (this.step(to)) {
        // drain target inbox
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let id = 0; id < this.n; id += 1) {
        if (!this.procs[id].online) {
          continue;
        }
        if (this.step(id)) {
          progressed = true;
        }
      }
    }
  }

  converged(): boolean {
    if (this.root === null) {
      return false;
    }
    const rootProc = this.procs[this.root];
    if (rootProc.dist !== 0 || rootProc.parent !== null) {
      return false;
    }
    for (let id = 0; id < this.n; id += 1) {
      const proc = this.procs[id];
      if (!proc.online) {
        continue;
      }
      if (proc.inbox.length > 0) {
        return false;
      }
      const dist = proc.dist;
      if (dist === null) {
        continue;
      }
      if (!Number.isInteger(dist) || dist < 0) {
        return false;
      }
      if (id === this.root) {
        if (dist !== 0 || proc.parent !== null) {
          return false;
        }
        continue;
      }
      if (proc.parent === null) {
        return false;
      }
      if (this.procs[proc.parent].dist !== dist - 1) {
        return false;
      }
    }
    return true;
  }

  rootId(): number | null { return this.root; }

  distOf(id: number): number | null {
    this.validId(id);
    return this.procs[id].dist;
  }

  parentOf(id: number): number | null {
    this.validId(id);
    return this.procs[id].parent;
  }

  childrenOf(id: number): number[] {
    this.validId(id);
    const children: number[] = [];
    for (let other = 0; other < this.n; other += 1) {
      const proc = this.procs[other];
      if (proc.online && proc.parent === id) {
        children.push(other);
      }
    }
    return children;
  }

  inTree(id: number): boolean {
    this.validId(id);
    return this.procs[id].dist !== null;
  }

  treeEdgeCount(): number {
    let count = 0;
    for (const proc of this.procs) {
      if (proc.online && proc.parent !== null) {
        count += 1;
      }
    }
    return count;
  }

  neighborsOf(id: number): number[] {
    this.validId(id);
    return this.neighbors[id].slice();
  }

  inboxSize(id: number): number {
    this.validId(id);
    return this.procs[id].inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.validId(id);
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.validId(id);
    return this.procs[id].online;
  }
}
