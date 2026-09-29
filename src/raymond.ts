import { VirtualClock } from "./clock.js";
import type { Message, ProcState } from "./types.js";
import {
  BusyError,
  InvalidProcessError,
  NotHolderError,
  OfflineError,
} from "./errors.js";
import { RProc } from "./process.js";
import { buildNeighbors, defaultEdges } from "./tree.js";

export type RaymondOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class Raymond {
  readonly clock: VirtualClock;

  private readonly procs: RProc[];
  private readonly neighbors: number[][];
  private msgCounter = 0;

  constructor(opts: RaymondOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 3;
    const edges = opts.edges ?? defaultEdges(n);
    this.neighbors = buildNeighbors(n, edges);
    this.procs = [];

    // Root 0 initially holds the token; every parent pointer points toward
    // the token holder (BFS tree rooted at 0).
    const parent = new Array<number>(n).fill(-1);
    parent[0] = 0;
    const queue = [0];
    while (queue.length > 0) {
      const node = queue.shift() as number;
      for (const next of this.neighbors[node]) {
        if (parent[next] === -1) {
          parent[next] = node;
          queue.push(next);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      this.procs.push(new RProc(i, parent[i]));
    }
  }

  request(id: number): string {
    this.requireValid(id);
    if (!this.procs[id].online) {
      throw new OfflineError(id);
    }
    const proc = this.procs[id];
    if (proc.state !== "idle") {
      throw new BusyError(id);
    }
    const msgId = this.nextMsgId();
    if (proc.parent === id) {
      // This process already holds the token: enter the critical section.
      proc.state = "held";
      return msgId;
    }
    const wasQueueEmpty = proc.queue.length === 0;
    proc.queue.push(id);
    proc.state = "waiting";
    if (wasQueueEmpty) {
      // First pending request: ask the parent for the token. The message is
      // delivered even if the parent is currently offline (it stays queued).
      this.send(proc.parent, { kind: "REQUEST", from: id, msgId });
    }
    return msgId;
  }

  release(id: number): string {
    this.requireValid(id);
    const proc = this.procs[id];
    if (proc.state !== "held") {
      throw new NotHolderError(id);
    }
    if (!proc.online) {
      throw new OfflineError(id);
    }
    proc.state = "idle";
    const msgId = this.nextMsgId();
    if (proc.queue.length === 0) {
      // Nobody asked for the token; keep holding it.
      return msgId;
    }
    const head = proc.queue.shift() as number;
    if (head === id) {
      // Should not happen in normal operation, but re-enter immediately.
      proc.state = "held";
    } else {
      this.passToken(id, head);
    }
    return msgId;
  }

  step(id: number): boolean {
    this.requireValid(id);
    if (!this.procs[id].online) {
      throw new OfflineError(id);
    }
    const proc = this.procs[id];
    if (proc.inbox.length === 0) {
      return false;
    }
    const msg = proc.inbox.shift() as Message;

    if (msg.kind === "REQUEST") {
      const j = msg.from;
      if (!proc.queue.includes(j)) {
        proc.queue.push(j);
      }
      if (this.hasToken(id) && proc.state === "idle") {
        const head = proc.queue.shift() as number;
        if (head === id) {
          proc.state = "held";
        } else {
          this.passToken(id, head);
        }
      } else if (!this.hasToken(id) && proc.queue.length === 1) {
        // First request while waiting for the token ourselves: forward it up.
        this.send(proc.parent, {
          kind: "REQUEST",
          from: id,
          msgId: this.nextMsgId(),
        });
      }
      return true;
    }

    // TOKEN: this process becomes the token holder.
    proc.parent = id;
    if (proc.queue.length === 0) {
      // Spurious token with nothing pending: stay idle and hold it.
      return true;
    }
    const head = proc.queue.shift() as number;
    if (head === id) {
      proc.state = "held";
    } else {
      this.passToken(id, head);
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain
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

  stateOf(id: number): ProcState {
    return this.proc(id).state;
  }

  parentOf(id: number): number {
    return this.proc(id).parent;
  }

  hasToken(id: number): boolean {
    return this.proc(id).parent === id;
  }

  /** Holder id, or null while the token is in transit. */
  holder(): number | null {
    for (const proc of this.procs) {
      if (proc.parent === proc.id) {
        return proc.id;
      }
    }
    return null;
  }

  queueOf(id: number): number[] {
    return [...this.proc(id).queue];
  }

  neighborsOf(id: number): number[] {
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

  private proc(id: number): RProc {
    this.requireValid(id);
    return this.procs[id];
  }

  private requireValid(id: number): void {
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 0 ||
      id >= this.procs.length
    ) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return String(this.msgCounter);
  }

  private send(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
  }

  /**
   * Hand the token held by `id` to requester `k`, updating the parent
   * pointer. If more requests remain, immediately ask `k` to forward the
   * token back once it is done.
   */
  private passToken(id: number, k: number): void {
    const proc = this.procs[id];
    this.send(k, { kind: "TOKEN", from: id, msgId: this.nextMsgId() });
    proc.parent = k;
    if (proc.queue.length > 0) {
      this.send(k, { kind: "REQUEST", from: id, msgId: this.nextMsgId() });
    }
  }
}
