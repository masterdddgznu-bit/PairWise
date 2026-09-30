import { VirtualClock } from "./clock.js";
import { EProc } from "./process.js";
import type { Message } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import { buildNeighbors, defaultEdges, isConnected } from "./graph.js";

export type EchoWaveOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class EchoWave {
  readonly clock: VirtualClock;
  private readonly procs: EProc[];
  private readonly neighbors: number[][];
  private root: number | null = null;
  private msgCounter = 0;

  constructor(opts: EchoWaveOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    const edges = opts.edges ?? defaultEdges(n);
    validateConfig(n, edges);
    this.procs = Array.from({ length: n }, (_, id) => new EProc(id));
    this.neighbors = buildNeighbors(n, edges);
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
  }

  private send(to: number, message: Message): void {
    if (this.procs[to].online) {
      this.procs[to].inbox.push(message);
    }
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return `m${this.msgCounter}`;
  }

  private complete(proc: EProc): void {
    if (proc.parent === null) {
      proc.decided = true;
    } else {
      this.send(proc.parent, {
        kind: "ECHO",
        from: proc.id,
        msgId: this.nextMsgId(),
      });
    }
  }

  start(rootId: number): number {
    this.checkId(rootId);
    if (!this.procs[rootId].online) throw new OfflineError(rootId);
    if (this.procs.some((proc) => proc.online && proc.inbox.length > 0)) {
      throw new BusyError();
    }
    if (this.root !== null && !this.converged()) throw new BusyError();

    for (const proc of this.procs) proc.resetWave();
    this.root = rootId;

    const root = this.procs[rootId];
    root.visited = true;
    root.parent = null;

    let sent = 0;
    for (const neighbor of this.neighbors[rootId]) {
      if (!this.procs[neighbor].online) continue;
      this.send(neighbor, {
        kind: "EXPLORE",
        from: rootId,
        msgId: this.nextMsgId(),
      });
      root.pending.add(neighbor);
      sent++;
    }
    if (root.pending.size === 0) root.decided = true;
    return sent;
  }

  step(id: number): boolean {
    this.checkId(id);
    if (!this.procs[id].online) throw new OfflineError(id);
    const proc = this.procs[id];
    const message = proc.inbox.shift();
    if (message === undefined) return false;
    const src = message.from;

    if (message.kind === "EXPLORE") {
      if (!proc.visited) {
        proc.visited = true;
        proc.parent = src;
        for (const neighbor of this.neighbors[id]) {
          if (!this.procs[neighbor].online || neighbor === src) continue;
          this.send(neighbor, {
            kind: "EXPLORE",
            from: id,
            msgId: this.nextMsgId(),
          });
          proc.pending.add(neighbor);
        }
        if (proc.pending.size === 0) this.complete(proc);
      } else {
        this.send(src, {
          kind: "ECHO",
          from: id,
          msgId: this.nextMsgId(),
        });
      }
    } else if (proc.pending.delete(src)) {
      proc.children.push(src);
      if (proc.pending.size === 0) this.complete(proc);
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain the target inbox
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const proc of this.procs) {
        if (!proc.online) continue;
        if (proc.inbox.length > 0) {
          this.step(proc.id);
          progressed = true;
        }
      }
    }
  }

  converged(): boolean {
    return (
      this.root !== null &&
      this.procs[this.root].decided &&
      this.procs.every((proc) => !proc.online || proc.inbox.length === 0)
    );
  }

  rootId(): number | null {
    return this.root;
  }

  parentOf(id: number): number | null {
    this.checkId(id);
    const proc = this.procs[id];
    if (!proc.visited || proc.parent === null) return null;
    return proc.parent;
  }

  childrenOf(id: number): number[] {
    this.checkId(id);
    return [...this.procs[id].children];
  }

  inTree(id: number): boolean {
    this.checkId(id);
    return this.procs[id].visited;
  }

  treeEdgeCount(): number {
    return this.procs.filter(
      (proc) => proc.online && proc.visited && proc.parent !== null,
    ).length;
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

function validateConfig(n: number, edges: number[][]): void {
  if (!Number.isInteger(n) || n < 2) {
    throw new InvalidConfigError(
      `processCount must be an integer >= 2, got ${n}`,
    );
  }
  if (!Array.isArray(edges)) {
    throw new InvalidConfigError("edges must be an array of edge pairs");
  }
  const seen = new Set<number>();
  for (const edge of edges) {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      !Number.isInteger(edge[0]) ||
      !Number.isInteger(edge[1])
    ) {
      throw new InvalidConfigError("each edge must be a pair of integer node ids");
    }
    const [a, b] = edge;
    if (a < 0 || a >= n || b < 0 || b >= n) {
      throw new InvalidConfigError(
        `edge references invalid endpoint: [${a}, ${b}]`,
      );
    }
    if (a === b) {
      throw new InvalidConfigError(`self loops are not allowed: [${a}, ${b}]`);
    }
    const key = a < b ? a * n + b : b * n + a;
    if (seen.has(key)) {
      throw new InvalidConfigError(`duplicate edge: [${a}, ${b}]`);
    }
    seen.add(key);
  }
  if (!isConnected(n, edges)) {
    throw new InvalidConfigError("graph must be connected");
  }
}
