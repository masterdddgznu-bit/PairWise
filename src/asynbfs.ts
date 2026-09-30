import { VirtualClock } from "./clock.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import { buildNeighbors, defaultEdges, isConnected } from "./graph.js";
import { BProc } from "./process.js";
import type { Message } from "./types.js";

export type AsyncBfsOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class AsyncBfs {
  readonly clock: VirtualClock;
  readonly processCount: number;

  private readonly processes: BProc[];
  private readonly neighbors: number[][];
  private currentRootId: number | null = null;
  private messageSequence = 0;

  constructor(opts: AsyncBfsOptions) {
    this.clock = opts.clock;

    const processCount = opts.processCount ?? 4;
    if (!Number.isSafeInteger(processCount) || processCount < 2) {
      throw new InvalidConfigError(`invalid process count: ${String(processCount)}`);
    }

    const edges = opts.edges ?? defaultEdges(processCount);
    this.neighbors = buildNeighbors(processCount, edges);
    if (!isConnected(processCount, edges)) {
      throw new InvalidConfigError("process graph must be connected");
    }

    this.processCount = processCount;
    this.processes = Array.from(
      { length: processCount },
      (_unused, id) => new BProc(id),
    );
  }

  start(rootId: number): number {
    const root = this.requireOnlineProcess(rootId);
    if (this.currentRootId !== null && !this.converged()) {
      throw new BusyError();
    }

    for (const process of this.processes) {
      process.reset();
    }

    this.currentRootId = root.id;
    root.dist = 0;
    root.parent = null;
    return this.broadcast(root, 0);
  }

  step(id: number): boolean {
    const process = this.requireOnlineProcess(id);
    const message = process.dequeue();
    if (message === undefined) {
      return false;
    }

    const candidate = message.d + 1;
    if (process.dist === null || candidate < process.dist) {
      process.dist = candidate;
      process.parent = message.from;
      this.broadcast(process, candidate);
    }

    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.requireOnlineProcess(to);
      while (this.step(to)) {
      }
      return;
    }

    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      for (const process of this.processes) {
        if (process.online && process.inbox.length > 0 && this.step(process.id)) {
          madeProgress = true;
        }
      }
    }
  }

  converged(): boolean {
    if (this.currentRootId === null) {
      return false;
    }

    const root = this.processes[this.currentRootId];
    if (root.dist !== 0 || root.parent !== null) {
      return false;
    }

    for (const process of this.processes) {
      if (!process.online) {
        continue;
      }
      if (process.inbox.length !== 0) {
        return false;
      }
      if (process.dist !== null && !this.isNonNegativeInteger(process.dist)) {
        return false;
      }
    }

    for (const process of this.processes) {
      if (process.id === root.id || process.dist === null) {
        continue;
      }

      const parentId = process.parent;
      if (
        parentId === null ||
        !Number.isSafeInteger(parentId) ||
        parentId < 0 ||
        parentId >= this.processCount
      ) {
        return false;
      }

      const parent = this.processes[parentId];
      if (parent.dist === null || parent.dist !== process.dist - 1) {
        return false;
      }
    }

    return true;
  }

  rootId(): number | null {
    return this.currentRootId;
  }

  distOf(id: number): number | null {
    return this.requireProcess(id).dist;
  }

  parentOf(id: number): number | null {
    return this.requireProcess(id).parent;
  }

  childrenOf(id: number): number[] {
    this.requireProcess(id);
    return this.processes
      .filter((process) => process.online && process.parent === id)
      .map((process) => process.id);
  }

  inTree(id: number): boolean {
    return this.distOf(id) !== null;
  }

  treeEdgeCount(): number {
    return this.processes.filter(
      (process) => process.online && process.parent !== null,
    ).length;
  }

  neighborsOf(id: number): number[] {
    this.requireProcess(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    return this.requireProcess(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.requireProcess(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.requireProcess(id).online;
  }

  private requireProcess(id: number): BProc {
    if (!Number.isSafeInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
    return this.processes[id];
  }

  private requireOnlineProcess(id: number): BProc {
    const process = this.requireProcess(id);
    if (!process.online) {
      throw new OfflineError(id);
    }
    return process;
  }

  private broadcast(sender: BProc, distance: number): number {
    let sent = 0;
    for (const neighborId of this.neighbors[sender.id]) {
      const recipient = this.processes[neighborId];
      if (!recipient.online) {
        continue;
      }

      recipient.enqueue({
        kind: "PULSE",
        d: distance,
        from: sender.id,
        msgId: this.nextMessageId(),
      });
      sent += 1;
    }
    return sent;
  }

  private nextMessageId(): string {
    return `pulse-${this.clock.now()}-${this.messageSequence++}`;
  }

  private isNonNegativeInteger(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
  }
}
