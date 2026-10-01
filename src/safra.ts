import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { SProc } from "./process.js";
import type { Color, Message } from "./types.js";

export type SafraOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Safra {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private procs: SProc[] = [];
  private started = false;
  private terminatedFlag = false;
  private seq = 0;

  constructor(opts: SafraOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    this.processCount = n;
    this.procs = Array.from({ length: n }, (_, i) => new SProc(i));
  }

  private proc(id: number): SProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    return `m${this.seq++}`;
  }

  reset(): void {
    for (const p of this.procs) {
      p.inbox = [];
      p.active = false;
      p.color = "white";
      p.count = 0;
    }
    this.started = false;
    this.terminatedFlag = false;
    this.seq = 0;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    for (const p of this.procs) {
      p.inbox = [];
      p.active = false;
      p.color = "white";
      p.count = 0;
    }
    this.terminatedFlag = false;
    this.started = true;
    this.procs[0].inbox.push({
      kind: "TOKEN",
      color: "white",
      count: 0,
      from: this.processCount - 1,
      msgId: this.nextMsgId(),
    });
  }

  send(from: number, to: number): void {
    if (!this.started) throw new BusyError("not started");
    if (from === to) throw new InvalidConfigError("from and to must differ");
    const src = this.proc(from);
    const dst = this.proc(to);
    src.count += 1;
    src.color = "black";
    dst.inbox.push({ kind: "BASIC", from, msgId: this.nextMsgId() });
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const head = p.inbox[0];
    if (!head) return false;
    if (head.kind === "BASIC") {
      p.inbox.shift();
      p.count -= 1;
      p.active = true;
      return true;
    }
    if (p.active) return false;
    p.inbox.shift();
    const token = head;
    if (p.color === "black") token.color = "black";
    token.count += p.count;
    p.color = "white";
    if (id === 0) {
      if (token.color === "white" && token.count === 0) {
        this.terminatedFlag = true;
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
        if (this.step(id)) progress = true;
      }
    }
  }

  localDone(id: number): void {
    if (!this.started) throw new BusyError("not started");
    this.proc(id).active = false;
  }

  terminated(): boolean {
    return this.terminatedFlag;
  }

  colorOf(id: number): Color {
    return this.proc(id).color;
  }

  countOf(id: number): number {
    return this.proc(id).count;
  }

  isActive(id: number): boolean {
    return this.proc(id).active;
  }

  hasToken(id: number): boolean {
    return this.proc(id).inbox.some((m: Message) => m.kind === "TOKEN");
  }

  nextOf(id: number): number {
    this.proc(id);
    return (id + 1) % this.processCount;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }
}
