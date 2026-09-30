import { VirtualClock } from "./clock.js";
import { TProc } from "./process.js";
import type { Message } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import {
  assertSimpleGraph,
  buildNeighbors,
  defaultEdges,
  isConnected,
} from "./graph.js";

export type TarryOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class Tarry {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly neighbors: number[][];
  private readonly procs: TProc[];
  private decided = false;
  private started = false;
  private root: number | null = null;
  private msgSeq = 0;

  constructor(opts: TarryOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2: ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    assertSimpleGraph(n, edges);
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("edges must form a connected graph");
    }
    this.n = n;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, id) => new TProc(id));
  }

  private assertValidId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private send(target: number, from: number): void {
    const destination = this.procs[target];
    if (!destination.online) {
      return;
    }
    this.msgSeq += 1;
    const message: Message = {
      kind: "TOKEN",
      from,
      msgId: `token-${this.msgSeq}`,
    };
    destination.enqueue(message);
  }

  start(rootId: number): number {
    this.assertValidId(rootId);
    if (!this.procs[rootId].online) {
      throw new OfflineError(rootId);
    }
    if (this.started && !this.converged()) {
      throw new BusyError();
    }

    for (const proc of this.procs) {
      proc.resetTraversal();
    }
    this.decided = false;
    this.root = rootId;
    this.started = true;

    const root = this.procs[rootId];
    root.visited = true;
    root.parent = null;

    const target = this.neighbors[rootId].find((nb) => this.procs[nb].online);
    if (target === undefined) {
      this.decided = true;
      return 0;
    }
    root.used.add(target);
    this.send(target, rootId);
    return 1;
  }

  step(id: number): boolean {
    this.assertValidId(id);
    const proc = this.procs[id];
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const message = proc.dequeue();
    if (message === undefined) {
      return false;
    }
    if (!proc.visited) {
      proc.visited = true;
      proc.parent = message.from;
    }

    const candidates = this.neighbors[id].filter(
      (nb) =>
        this.procs[nb].online && !proc.used.has(nb) && nb !== proc.parent,
    );
    if (candidates.length > 0) {
      const target = candidates[0];
      proc.used.add(target);
      this.send(target, id);
      return true;
    }
    if (proc.parent !== null) {
      proc.used.add(proc.parent);
      this.send(proc.parent, id);
      return true;
    }
    this.decided = true;
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
      for (let id = 0; id < this.n; id++) {
        const proc = this.procs[id];
        if (proc.online && proc.inbox.length > 0) {
          this.step(id);
          progressed = true;
        }
      }
    }
  }

  converged(): boolean {
    if (!this.decided) {
      return false;
    }
    return this.procs.every((proc) => !proc.online || proc.inbox.length === 0);
  }

  rootId(): number | null {
    return this.root;
  }

  parentOf(id: number): number | null {
    this.assertValidId(id);
    return this.procs[id].parent;
  }

  childrenOf(id: number): number[] {
    this.assertValidId(id);
    const children: number[] = [];
    for (const proc of this.procs) {
      if (proc.online && proc.parent === id) {
        children.push(proc.id);
      }
    }
    return children;
  }

  inTree(id: number): boolean {
    this.assertValidId(id);
    return this.procs[id].visited;
  }

  treeEdgeCount(): number {
    return this.procs.reduce(
      (count, proc) =>
        count + (proc.online && proc.parent !== null ? 1 : 0),
      0,
    );
  }

  neighborsOf(id: number): number[] {
    this.assertValidId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    this.assertValidId(id);
    return this.procs[id].inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.assertValidId(id);
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.assertValidId(id);
    return this.procs[id].online;
  }
}
