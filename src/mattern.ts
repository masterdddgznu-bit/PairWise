import { VirtualClock } from "./clock.js";
import { MProc } from "./process.js";
import type { Message } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "./errors.js";

export type MatternOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Mattern {
  readonly clock: VirtualClock;
  private readonly n: number;
  private procs: MProc[] = [];
  private started = false;
  private isTerminated = false;
  private msgCounter = 0;

  constructor(opts: MatternOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    this.n = n;
    this.procs = Array.from({ length: n }, (_, i) => new MProc(i, this.n));
  }

  reset(): void {
    this.procs = Array.from({ length: this.n }, (_, i) => new MProc(i, this.n));
    this.started = false;
    this.isTerminated = false;
    this.msgCounter = 0;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.procs = Array.from({ length: this.n }, (_, i) => new MProc(i, this.n));
    this.isTerminated = false;
    this.procs[0].inbox.push(this.newProbe(0, false, this.n - 1));
    this.started = true;
  }

  send(from: number, to: number): void {
    this.requireStarted();
    if (from === to) {
      throw new InvalidConfigError(`from and to must differ (got ${from})`);
    }
    this.checkId(from);
    this.checkId(to);
    const sender = this.procs[from];
    sender.vc[from] += 1;
    sender.delta += 1;
    sender.black = true;
    const msg: Message = {
      kind: "BASIC",
      from,
      vc: sender.vc.slice(),
      msgId: this.nextMsgId(),
    };
    this.procs[to].inbox.push(msg);
  }

  step(id: number): boolean {
    this.requireStarted();
    this.checkId(id);
    const proc = this.procs[id];
    const msg = proc.inbox[0];
    if (msg === undefined) return false;
    if (msg.kind === "BASIC") {
      proc.inbox.shift();
      for (let k = 0; k < this.n; k += 1) {
        proc.vc[k] = Math.max(proc.vc[k], msg.vc[k]);
      }
      proc.vc[id] += 1;
      proc.delta -= 1;
      proc.active = true;
      return true;
    }
    if (proc.active) return false;
    proc.inbox.shift();
    const sum = msg.sum + proc.delta;
    const black = msg.black || proc.black;
    proc.black = false;
    if (id === 0) {
      if (sum === 0 && !black) {
        this.isTerminated = true;
      } else {
        this.procs[this.nextOf(0)].inbox.push(this.newProbe(0, false, 0));
      }
    } else {
      this.procs[this.nextOf(id)].inbox.push(this.newProbe(sum, black, id));
    }
    return true;
  }

  pump(): void {
    this.requireStarted();
    for (;;) {
      let progress = false;
      for (let id = 0; id < this.n; id += 1) {
        if (this.step(id)) progress = true;
      }
      if (!progress) return;
    }
  }

  localDone(id: number): void {
    this.requireStarted();
    this.checkId(id);
    this.procs[id].active = false;
  }

  terminated(): boolean {
    return this.isTerminated;
  }

  deltaOf(id: number): number {
    return this.procs[this.checkId(id)].delta;
  }

  vectorOf(id: number): number[] {
    return this.procs[this.checkId(id)].vc.slice();
  }

  isActive(id: number): boolean {
    return this.procs[this.checkId(id)].active;
  }

  isBlack(id: number): boolean {
    return this.procs[this.checkId(id)].black;
  }

  hasProbe(id: number): boolean {
    return this.procs[this.checkId(id)].inbox.some((m) => m.kind === "PROBE");
  }

  nextOf(id: number): number {
    this.checkId(id);
    return (id + 1) % this.n;
  }

  inboxSize(id: number): number {
    return this.procs[this.checkId(id)].inbox.length;
  }

  private newProbe(sum: number, black: boolean, from: number): Message {
    return { kind: "PROBE", sum, black, from, msgId: this.nextMsgId() };
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return `m${this.msgCounter}`;
  }

  private requireStarted(): void {
    if (!this.started) throw new BusyError("not started");
  }

  private checkId(id: number): number {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return id;
  }
}
