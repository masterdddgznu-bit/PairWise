import { VirtualClock } from "./clock.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  NotHolderError,
  OfflineError,
} from "./errors.js";
import { RProc } from "./process.js";
import { buildNeighbors, defaultEdges, validateTree } from "./tree.js";
import type { Message, ProcState } from "./types.js";

export type RaymondOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class Raymond {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private readonly procs: RProc[];
  private readonly neighbors: number[][];
  private nextMsg = 1;

  constructor(opts: RaymondOptions) {
    const n = opts.processCount ?? 3;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 2, got ${String(n)}`,
      );
    }
    const edges = opts.edges ?? defaultEdges(n);
    validateTree(n, edges);

    this.clock = opts.clock;
    this.processCount = n;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = [];
    for (let i = 0; i < n; i++) {
      this.procs.push(new RProc(i, 0));
    }
    this.procs[0].parent = 0;
  }

  private mintMsgId(): string {
    return String(this.nextMsg++);
  }

  private proc(id: number): RProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private send(target: number, message: Message): void {
    this.procs[target].inbox.push(message);
  }

  private sendRequest(from: number, target: number, msgId: string): void {
    this.send(target, { kind: "REQUEST", from, msgId });
  }

  private sendToken(from: number, target: number, msgId: string): void {
    this.send(target, { kind: "TOKEN", from, msgId });
  }

  /**
   * Holder (parent === self) services the head of its request queue:
   * either re-enters its own critical section or forwards the token,
   * re-requesting it when more requests remain queued.
   */
  private dispatchHead(p: RProc): void {
    const k = p.shiftQueue();
    if (k === undefined) {
      return;
    }
    if (k === p.id) {
      p.state = "held";
      return;
    }
    this.sendToken(p.id, k, this.mintMsgId());
    p.parent = k;
    if (p.queue.length > 0) {
      this.sendRequest(p.id, k, this.mintMsgId());
    }
  }

  request(id: number): string {
    const p = this.proc(id);
    if (!p.online) {
      throw new OfflineError(id);
    }
    if (p.state !== "idle") {
      throw new BusyError(id);
    }

    const msgId = this.mintMsgId();
    if (p.parent === id) {
      p.state = "held";
      return msgId;
    }

    const wasEmpty = p.queue.length === 0;
    p.queue.push(id);
    p.state = "waiting";
    if (wasEmpty) {
      this.sendRequest(id, p.parent, msgId);
    }
    return msgId;
  }

  release(id: number): string {
    const p = this.proc(id);
    if (p.state !== "held") {
      throw new NotHolderError(id);
    }
    if (!p.online) {
      throw new OfflineError(id);
    }

    const msgId = this.mintMsgId();
    p.state = "idle";

    if (p.queue.length > 0) {
      const k = p.shiftQueue() as number;
      if (k === id) {
        p.state = "held";
      } else {
        this.sendToken(id, k, msgId);
        p.parent = k;
        if (p.queue.length > 0) {
          this.sendRequest(id, k, this.mintMsgId());
        }
      }
    }
    return msgId;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!p.online) {
      throw new OfflineError(id);
    }
    const message = p.popInbox();
    if (message === undefined) {
      return false;
    }

    if (message.kind === "REQUEST") {
      const requester = message.from;
      p.enqueueRequester(requester);

      if (p.parent === id && p.state === "idle") {
        this.dispatchHead(p);
      } else if (p.parent !== id && p.queue.length === 1) {
        this.sendRequest(id, p.parent, this.mintMsgId());
      }
      return true;
    }

    // TOKEN
    p.parent = id;
    const k = p.shiftQueue();
    if (k === undefined) {
      return true;
    }
    if (k === id) {
      p.state = "held";
    } else {
      this.sendToken(id, k, this.mintMsgId());
      p.parent = k;
      if (p.queue.length > 0) {
        this.sendRequest(id, k, this.mintMsgId());
      }
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
      for (const p of this.procs) {
        if (p.online && p.inbox.length > 0) {
          this.step(p.id);
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
    const p = this.proc(id);
    return p.parent === id;
  }

  holder(): number | null {
    for (const p of this.procs) {
      if (p.parent === p.id) {
        return p.id;
      }
    }
    return null;
  }

  queueOf(id: number): number[] {
    return [...this.proc(id).queue];
  }

  neighborsOf(id: number): number[] {
    return [...this.neighbors[id] ?? []];
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
