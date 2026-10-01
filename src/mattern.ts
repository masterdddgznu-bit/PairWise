import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { MProc } from "./process.js";
import type { Message } from "./types.js";

export type MatternOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Mattern {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private procs: MProc[] = [];
  private started = false;
  private isTerminated = false;
  private msgSeq = 0;

  constructor(opts: MatternOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    this.processCount = n;
    this.initProcs();
  }

  private initProcs(): void {
    this.procs = [];
    for (let i = 0; i < this.processCount; i++) {
      const p = new MProc(i);
      p.vc = new Array(this.processCount).fill(0);
      this.procs.push(p);
    }
  }

  private proc(id: number): MProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    this.msgSeq += 1;
    return `m${this.msgSeq}`;
  }

  reset(): void {
    this.started = false;
    this.isTerminated = false;
    this.initProcs();
  }

  start(): void {
    if (this.started) {
      throw new BusyError("already started");
    }
    this.initProcs();
    this.isTerminated = false;
    this.started = true;
    this.procs[0].inbox.push({
      kind: "PROBE",
      sum: 0,
      black: false,
      from: this.processCount - 1,
      msgId: this.nextMsgId(),
    });
  }

  send(from: number, to: number): void {
    if (!this.started) {
      throw new BusyError("not started");
    }
    const sender = this.proc(from);
    const receiver = this.proc(to);
    if (from === to) {
      throw new InvalidConfigError("from and to must differ");
    }
    sender.vc[from] += 1;
    sender.delta += 1;
    sender.black = true;
    receiver.inbox.push({
      kind: "BASIC",
      from,
      vc: sender.vc.slice(),
      msgId: this.nextMsgId(),
    });
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox[0];
    if (!msg) {
      return false;
    }
    if (msg.kind === "BASIC") {
      p.inbox.shift();
      for (let k = 0; k < this.processCount; k++) {
        p.vc[k] = Math.max(p.vc[k], msg.vc[k]);
      }
      p.vc[id] += 1;
      p.delta -= 1;
      p.active = true;
      return true;
    }
    if (p.active) {
      return false;
    }
    p.inbox.shift();
    const sum = msg.sum + p.delta;
    const black = msg.black || p.black;
    p.black = false;
    if (id === 0) {
      if (sum === 0 && !black) {
        this.isTerminated = true;
      } else {
        this.procs[this.nextOf(0)].inbox.push({
          kind: "PROBE",
          sum: 0,
          black: false,
          from: 0,
          msgId: this.nextMsgId(),
        });
      }
    } else {
      this.procs[this.nextOf(id)].inbox.push({
        kind: "PROBE",
        sum,
        black,
        from: id,
        msgId: this.nextMsgId(),
      });
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
    this.proc(id).active = false;
  }

  terminated(): boolean {
    return this.isTerminated;
  }

  deltaOf(id: number): number {
    return this.proc(id).delta;
  }

  vectorOf(id: number): number[] {
    return this.proc(id).vc.slice();
  }

  isActive(id: number): boolean {
    return this.proc(id).active;
  }

  isBlack(id: number): boolean {
    return this.proc(id).black;
  }

  hasProbe(id: number): boolean {
    return this.proc(id).inbox.some((m: Message) => m.kind === "PROBE");
  }

  nextOf(id: number): number {
    this.proc(id);
    return (id + 1) % this.processCount;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }
}
