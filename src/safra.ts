import { VirtualClock } from "./clock.js";
import { SProc } from "./process.js";
import type { Color, Message } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "./errors.js";

export type SafraOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Safra {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private procs: SProc[];
  private started = false;
  private isTerminated = false;
  private msgSeq = 0;

  constructor(opts: SafraOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    this.processCount = n;
    this.procs = Array.from({ length: n }, (_, i) => new SProc(i));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    return `m${this.clock.now()}-${this.msgSeq++}`;
  }

  reset(): void {
    this.started = false;
    this.isTerminated = false;
    for (const p of this.procs) {
      p.inbox = [];
      p.active = false;
      p.color = "white";
      p.count = 0;
    }
  }

  start(): void {
    if (this.started) {
      throw new BusyError("already started");
    }
    this.reset();
    this.started = true;
    const token: Message = {
      kind: "TOKEN",
      color: "white",
      count: 0,
      from: this.processCount - 1,
      msgId: this.nextMsgId(),
    };
    this.procs[0].inbox.push(token);
  }

  send(from: number, to: number): void {
    if (!this.started) {
      throw new BusyError("not started");
    }
    this.checkId(from);
    this.checkId(to);
    if (from === to) {
      throw new InvalidConfigError(`from and to must differ (got ${from})`);
    }
    const src = this.procs[from];
    src.count += 1;
    src.color = "black";
    this.procs[to].inbox.push({
      kind: "BASIC",
      from,
      msgId: this.nextMsgId(),
    });
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    const head = p.inbox[0];
    if (head === undefined) {
      return false;
    }
    if (head.kind === "BASIC") {
      p.inbox.shift();
      p.count -= 1;
      p.active = true;
      return true;
    }
    // TOKEN
    if (p.active) {
      return false;
    }
    p.inbox.shift();
    const token = head;
    if (p.color === "black") {
      token.color = "black";
    }
    token.count += p.count;
    p.color = "white";
    if (id === 0) {
      if (token.color === "white" && token.count === 0) {
        this.isTerminated = true;
      } else {
        this.procs[this.nextOf(0)].inbox.push({
          kind: "TOKEN",
          color: "white",
          count: 0,
          from: 0,
          msgId: this.nextMsgId(),
        });
      }
    } else {
      token.from = id;
      this.procs[this.nextOf(id)].inbox.push(token);
    }
    return true;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (let id = 0; id < this.processCount; id++) {
        if (this.step(id)) {
          progress = true;
        }
      }
    }
  }

  localDone(id: number): void {
    if (!this.started) {
      throw new BusyError("not started");
    }
    this.checkId(id);
    this.procs[id].active = false;
  }

  terminated(): boolean {
    return this.isTerminated;
  }

  colorOf(id: number): Color {
    this.checkId(id);
    return this.procs[id].color;
  }

  countOf(id: number): number {
    this.checkId(id);
    return this.procs[id].count;
  }

  isActive(id: number): boolean {
    this.checkId(id);
    return this.procs[id].active;
  }

  hasToken(id: number): boolean {
    this.checkId(id);
    return this.procs[id].inbox.some((m) => m.kind === "TOKEN");
  }

  nextOf(id: number): number {
    this.checkId(id);
    return (id + 1) % this.processCount;
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }
}
