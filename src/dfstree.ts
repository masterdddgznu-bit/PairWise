import { VirtualClock } from "./clock.js";
import { DProc } from "./process.js";
import { defaultEdges, buildNeighbors, isConnected } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type { Message } from "./types.js";

export type DfsTreeOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class DfsTree {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly neighbors: number[][];
  private readonly procs: DProc[];
  private root: number | null = null;
  private started = false;
  private decided = false;
  private msgSeq = 0;

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
    this.n = n;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, i) => new DProc(i));
  }

  private validateEdges(n: number, edges: number[][]): void {
    const seen = new Set<string>();
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new InvalidConfigError("edge must be a pair of process ids");
      }
      const [a, b] = edge;
      for (const v of [a, b]) {
        if (!Number.isInteger(v) || v < 0 || v >= n) {
          throw new InvalidConfigError(`edge endpoint out of range: ${v}`);
        }
      }
      if (a === b) {
        throw new InvalidConfigError(`self-loop not allowed: ${a}`);
      }
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) {
        throw new InvalidConfigError(`duplicate edge: ${key}`);
      }
      seen.add(key);
    }
  }

  private proc(id: number): DProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    return `m${this.clock.now()}-${this.msgSeq++}`;
  }

  private send(to: number, msg: Message): void {
    const target = this.procs[to];
    if (target.online) target.inbox.push(msg);
  }

  start(rootId: number): number {
    const root = this.proc(rootId);
    if (!root.online) throw new OfflineError(rootId);
    if (this.started && !this.converged()) throw new BusyError();
    for (const p of this.procs) p.reset();
    this.decided = false;
    this.started = true;
    this.root = rootId;
    root.visited = true;
    root.parent = null;
    const target = this.neighbors[rootId].find((v) => this.procs[v].online);
    if (target === undefined) {
      this.decided = true;
      return 0;
    }
    root.used.add(target);
    this.send(target, { kind: "EXPLORE", from: rootId, msgId: this.nextMsgId() });
    return 1;
  }

  private advance(id: number): void {
    const p = this.procs[id];
    const target = this.neighbors[id].find(
      (v) => v !== p.parent && !p.used.has(v) && this.procs[v].online,
    );
    if (target !== undefined) {
      p.used.add(target);
      this.send(target, { kind: "EXPLORE", from: id, msgId: this.nextMsgId() });
      return;
    }
    if (p.parent !== null) {
      this.send(p.parent, { kind: "RETURN", from: id, msgId: this.nextMsgId() });
      return;
    }
    this.decided = true;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    if (msg.kind === "EXPLORE") {
      if (p.visited) {
        this.send(msg.from, { kind: "RETURN", from: id, msgId: this.nextMsgId() });
        return true;
      }
      p.visited = true;
      p.parent = msg.from;
      this.advance(id);
      return true;
    }
    this.advance(id);
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      const p = this.proc(to);
      while (p.online && this.step(to)) {
        /* drain */
      }
      return;
    }
    for (;;) {
      let progress = false;
      for (const p of this.procs) {
        if (!p.online) continue;
        if (this.step(p.id)) progress = true;
      }
      if (!progress) break;
    }
  }

  converged(): boolean {
    if (!this.decided) return false;
    return this.procs.every((p) => !p.online || p.inbox.length === 0);
  }

  rootId(): number | null {
    return this.root;
  }

  parentOf(id: number): number | null {
    return this.proc(id).parent;
  }

  childrenOf(id: number): number[] {
    this.proc(id);
    return this.procs
      .filter((p) => p.online && p.parent === id)
      .map((p) => p.id)
      .sort((a, b) => a - b);
  }

  inTree(id: number): boolean {
    return this.proc(id).visited;
  }

  treeEdgeCount(): number {
    return this.procs.filter((p) => p.visited && p.parent !== null).length;
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.proc(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }
}
