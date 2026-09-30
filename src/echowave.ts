import { VirtualClock } from "./clock.js";
import { EProc } from "./process.js";
import type { Message } from "./types.js";
import {
  BusyError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import { buildNeighbors, defaultEdges, validateGraph } from "./graph.js";

export type EchoWaveOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class EchoWave {
  readonly clock: VirtualClock;
  private readonly procs: EProc[];
  private readonly neighbors: number[][];
  private currentRoot: number | null = null;
  private msgCounter = 0;

  constructor(opts: EchoWaveOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    const edges = opts.edges ?? defaultEdges(n);
    validateGraph(n, edges);
    this.procs = Array.from({ length: n }, (_, id) => new EProc(id));
    this.neighbors = buildNeighbors(n, edges);
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
  }

  start(rootId: number): number {
    this.checkId(rootId);
    if (!this.procs[rootId].online) {
      throw new OfflineError(rootId);
    }
    const inProgress =
      this.currentRoot !== null && !this.procs[this.currentRoot].decided;
    const pendingMessages = this.procs.some(
      (proc) => proc.online && proc.inbox.length > 0,
    );
    if (inProgress || pendingMessages) {
      throw new BusyError();
    }

    for (const proc of this.procs) {
      proc.reset();
    }
    this.currentRoot = rootId;

    const root = this.procs[rootId];
    root.visited = true;
    root.parent = null;

    let sent = 0;
    for (const neighborId of this.neighbors[rootId]) {
      if (!this.procs[neighborId].online) {
        continue;
      }
      this.deliver(neighborId, {
        kind: "EXPLORE",
        from: rootId,
        msgId: this.nextMsgId(),
      });
      root.pending.add(neighborId);
      sent++;
    }
    if (root.pending.size === 0) {
      root.decided = true;
    }
    return sent;
  }

  step(id: number): boolean {
    this.checkId(id);
    const proc = this.procs[id];
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const message = proc.inbox.shift();
    if (message === undefined) {
      return false;
    }

    if (message.kind === "EXPLORE") {
      if (!proc.visited) {
        proc.visited = true;
        proc.parent = message.from;
        for (const neighborId of this.neighbors[id]) {
          if (neighborId === message.from || !this.procs[neighborId].online) {
            continue;
          }
          this.deliver(neighborId, {
            kind: "EXPLORE",
            from: id,
            msgId: this.nextMsgId(),
          });
          proc.pending.add(neighborId);
        }
        if (proc.pending.size === 0) {
          this.localComplete(id);
        }
      } else {
        this.deliver(message.from, {
          kind: "ECHO",
          from: id,
          msgId: this.nextMsgId(),
        });
      }
    } else {
      if (proc.pending.delete(message.from)) {
        proc.children.push(message.from);
      }
      if (proc.pending.size === 0) {
        this.localComplete(id);
      }
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.checkId(to);
      while (this.step(to)) {
        // drain target inbox
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const proc of this.procs) {
        if (proc.online && proc.inbox.length > 0) {
          this.step(proc.id);
          progressed = true;
        }
      }
    }
  }

  converged(): boolean {
    if (this.currentRoot === null) {
      return false;
    }
    if (!this.procs[this.currentRoot].decided) {
      return false;
    }
    return this.procs.every((proc) => !proc.online || proc.inbox.length === 0);
  }

  rootId(): number | null {
    return this.currentRoot;
  }

  parentOf(id: number): number | null {
    this.checkId(id);
    const proc = this.procs[id];
    if (!proc.visited) {
      return null;
    }
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
    let count = 0;
    for (const proc of this.procs) {
      if (proc.online && proc.visited && proc.parent !== null) {
        count++;
      }
    }
    return count;
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

  private nextMsgId(): string {
    this.msgCounter += 1;
    return `m${this.msgCounter}`;
  }

  private deliver(to: number, message: Message): void {
    if (!this.procs[to].online) {
      return;
    }
    this.procs[to].inbox.push(message);
  }

  private localComplete(id: number): void {
    const proc = this.procs[id];
    if (proc.parent === null) {
      proc.decided = true;
    } else {
      this.deliver(proc.parent, {
        kind: "ECHO",
        from: id,
        msgId: this.nextMsgId(),
      });
    }
  }
}
