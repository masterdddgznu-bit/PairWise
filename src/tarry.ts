import { VirtualClock } from "./clock.js";
import { TProc } from "./process.js";
import { defaultEdges, buildNeighbors, isConnected } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type { Message } from "./types.js";

export type TarryOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class Tarry {
  readonly clock: VirtualClock;
  private readonly procs: TProc[];
  private readonly neighbors: number[][];
  private root: number | null = null;
  private started = false;
  private msgCounter = 0;

  constructor(opts: TarryOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    Tarry.validateEdges(n, edges);
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("edges do not form a connected graph");
    }
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, i) => new TProc(i));
  }

  private static validateEdges(n: number, edges: number[][]): void {
    if (!Array.isArray(edges)) {
      throw new InvalidConfigError("edges must be an array of [a, b] pairs");
    }
    const seen = new Set<string>();
    for (const e of edges) {
      if (!Array.isArray(e) || e.length !== 2) {
        throw new InvalidConfigError("each edge must be a [a, b] pair");
      }
      const [a, b] = e;
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < 0 ||
        a >= n ||
        b >= n
      ) {
        throw new InvalidConfigError(`invalid edge endpoint: [${a}, ${b}]`);
      }
      if (a === b) {
        throw new InvalidConfigError(`self loop at process ${a}`);
      }
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) {
        throw new InvalidConfigError(`duplicate edge: [${a}, ${b}]`);
      }
      seen.add(key);
    }
  }

  private checkId(id: number): number {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
    return id;
  }

  private send(from: number, to: number): void {
    const msg: Message = { kind: "TOKEN", from, msgId: `m${this.msgCounter++}` };
    this.procs[to].inbox.push(msg);
  }

  private onlineNeighbors(id: number): number[] {
    return this.neighbors[id].filter((nb) => this.procs[nb].online);
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
    for (const p of this.procs) {
      p.reset();
    }
    this.root = rootId;
    this.started = true;
    root.visited = true;
    root.parent = null;
    const candidates = this.onlineNeighbors(rootId);
    if (candidates.length === 0) {
      root.decided = true;
      return 0;
    }
    const next = candidates[0];
    root.used.add(next);
    this.send(rootId, next);
    return 1;
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    if (!p.online) {
      throw new OfflineError(id);
    }
    const msg = p.inbox.shift();
    if (!msg) {
      return false;
    }
    if (!p.visited) {
      p.visited = true;
      p.parent = msg.from;
    }
    const forward = this.onlineNeighbors(id).filter(
      (nb) => !p.used.has(nb) && nb !== p.parent,
    );
    if (forward.length > 0) {
      const next = forward[0];
      p.used.add(next);
      this.send(id, next);
    } else if (p.parent !== null) {
      p.used.add(p.parent);
      this.send(id, p.parent);
    } else {
      p.decided = true;
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.checkId(to);
      if (!this.procs[to].online) {
        return;
      }
      while (this.step(to)) {
        /* drain inbox */
      }
      return;
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        if (!p.online) {
          continue;
        }
        while (p.inbox.length > 0) {
          this.step(p.id);
          progress = true;
        }
      }
    }
  }

  converged(): boolean {
    if (!this.started || this.root === null) {
      return false;
    }
    if (!this.procs[this.root].decided) {
      return false;
    }
    return this.procs.every((p) => !p.online || p.inbox.length === 0);
  }

  rootId(): number | null {
    return this.root;
  }

  parentOf(id: number): number | null {
    return this.procs[this.checkId(id)].parent;
  }

  childrenOf(id: number): number[] {
    this.checkId(id);
    return this.procs
      .filter((p) => p.online && p.parent === id)
      .map((p) => p.id);
  }

  inTree(id: number): boolean {
    return this.procs[this.checkId(id)].visited;
  }

  treeEdgeCount(): number {
    return this.procs.filter((p) => p.online && p.parent !== null).length;
  }

  neighborsOf(id: number): number[] {
    return [...this.neighbors[this.checkId(id)]];
  }

  inboxSize(id: number): number {
    return this.procs[this.checkId(id)].inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.procs[this.checkId(id)].online = online;
  }

  isOnline(id: number): boolean {
    return this.procs[this.checkId(id)].online;
  }
}
