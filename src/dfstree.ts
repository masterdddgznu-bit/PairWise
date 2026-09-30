import { VirtualClock } from "./clock.js";
import { DProc } from "./process.js";
import type { Message } from "./types.js";
import { defaultEdges, buildNeighbors, isConnected } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";

export type DfsTreeOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class DfsTree {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private readonly neighbors: number[][];
  private readonly procs: DProc[];
  private root: number | null = null;
  private started = false;
  private msgCounter = 0;

  constructor(opts: DfsTreeOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    this.validateEdges(n, edges);
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("edges do not form a connected graph");
    }
    this.processCount = n;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, id) => new DProc(id));
  }

  private validateEdges(n: number, edges: number[][]): void {
    const seen = new Set<string>();
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new InvalidConfigError("edge must be a pair of process ids");
      }
      const [a, b] = edge;
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new InvalidConfigError("edge endpoints must be integers");
      }
      if (a < 0 || a >= n || b < 0 || b >= n) {
        throw new InvalidConfigError(`edge endpoint out of range: [${a}, ${b}]`);
      }
      if (a === b) {
        throw new InvalidConfigError(`self loop not allowed: [${a}, ${b}]`);
      }
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) {
        throw new InvalidConfigError(`duplicate edge: [${a}, ${b}]`);
      }
      seen.add(key);
    }
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return `m${this.msgCounter}`;
  }

  private send(to: number, msg: Message): void {
    const target = this.procs[to];
    if (!target.online) {
      return;
    }
    target.inbox.push(msg);
  }

  start(rootId: number): number {
    this.checkId(rootId);
    const root = this.procs[rootId];
    if (!root.online) {
      throw new OfflineError(rootId);
    }
    if (this.started && !this.converged()) {
      throw new BusyError();
    }
    for (const proc of this.procs) {
      proc.visited = false;
      proc.parent = null;
      proc.decided = false;
      proc.used.clear();
      proc.inbox = [];
    }
    this.root = rootId;
    this.started = true;
    root.visited = true;
    root.parent = null;
    const next = this.neighbors[rootId].find((id) => this.procs[id].online);
    if (next === undefined) {
      root.decided = true;
      return 0;
    }
    root.used.add(next);
    this.send(next, { kind: "EXPLORE", from: rootId, msgId: this.nextMsgId() });
    return 1;
  }

  step(id: number): boolean {
    this.checkId(id);
    const proc = this.procs[id];
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const msg = proc.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    if (msg.kind === "EXPLORE") {
      if (proc.visited) {
        this.send(msg.from, { kind: "RETURN", from: id, msgId: this.nextMsgId() });
        return true;
      }
      proc.visited = true;
      proc.parent = msg.from;
      this.advance(id);
      return true;
    }
    this.advance(id);
    return true;
  }

  private advance(id: number): void {
    const proc = this.procs[id];
    const next = this.neighbors[id].find(
      (nb) => nb !== proc.parent && !proc.used.has(nb) && this.procs[nb].online,
    );
    if (next !== undefined) {
      proc.used.add(next);
      this.send(next, { kind: "EXPLORE", from: id, msgId: this.nextMsgId() });
      return;
    }
    if (proc.parent !== null) {
      this.send(proc.parent, { kind: "RETURN", from: id, msgId: this.nextMsgId() });
      return;
    }
    proc.decided = true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.checkId(to);
      if (!this.procs[to].online) {
        return;
      }
      while (this.step(to)) {
        // drain inbox of `to`
      }
      return;
    }
    for (;;) {
      let progress = false;
      for (const proc of this.procs) {
        if (!proc.online) {
          continue;
        }
        if (this.step(proc.id)) {
          progress = true;
        }
      }
      if (!progress) {
        return;
      }
    }
  }

  converged(): boolean {
    if (this.root === null) {
      return false;
    }
    if (!this.procs[this.root].decided) {
      return false;
    }
    return this.procs.every((proc) => !proc.online || proc.inbox.length === 0);
  }

  rootId(): number | null {
    return this.root;
  }

  parentOf(id: number): number | null {
    this.checkId(id);
    return this.procs[id].parent;
  }

  childrenOf(id: number): number[] {
    this.checkId(id);
    return this.procs
      .filter((proc) => proc.online && proc.parent === id)
      .map((proc) => proc.id);
  }

  inTree(id: number): boolean {
    this.checkId(id);
    return this.procs[id].visited;
  }

  treeEdgeCount(): number {
    return this.procs.filter((proc) => proc.parent !== null).length;
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.checkId(id);
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online;
  }
}
