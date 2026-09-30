import { VirtualClock } from "./clock.js";
import type { Message, ProcState } from "./types.js";
import { NProc } from "./process.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  NotHolderError,
  OfflineError,
} from "./errors.js";

export type NaimiOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Naimi {
  readonly clock: VirtualClock;
  private readonly procs: NProc[];
  private msgCounter = 0;

  constructor(opts: NaimiOptions) {
    this.clock = opts.clock;
    const count = opts.processCount ?? 3;
    if (!Number.isInteger(count) || count < 2) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 2, got: ${String(opts.processCount)}`,
      );
    }
    this.procs = Array.from({ length: count }, (_v, id) => {
      const proc = new NProc(id, 0);
      if (id === 0) proc.token = true;
      return proc;
    });
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return String(this.msgCounter);
  }

  private isValid(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < this.procs.length;
  }

  private requireProc(id: number): NProc {
    if (!this.isValid(id)) throw new InvalidProcessError(id);
    return this.procs[id];
  }

  private requireOnline(id: number): NProc {
    const proc = this.requireProc(id);
    if (!proc.online) throw new OfflineError(id);
    return proc;
  }

  private deliver(target: number, message: Message): void {
    this.procs[target].inbox.push(message);
  }

  private sendToken(id: number, to: number): string {
    const msgId = this.nextMsgId();
    this.deliver(to, { kind: "TOKEN", from: id, msgId });
    return msgId;
  }

  request(id: number): string {
    const proc = this.requireOnline(id);
    if (proc.state !== "idle") throw new BusyError(id);
    proc.requesting = true;
    if (proc.token) {
      proc.state = "held";
      return this.nextMsgId();
    }
    proc.state = "waiting";
    const msgId = this.nextMsgId();
    this.deliver(proc.last, { kind: "REQUEST", from: id, msgId });
    proc.last = id;
    return msgId;
  }

  release(id: number): string {
    const proc = this.requireProc(id);
    if (proc.state !== "held") throw new NotHolderError(id);
    if (!proc.online) throw new OfflineError(id);
    proc.state = "idle";
    proc.requesting = false;
    if (proc.next !== null) {
      const k = proc.next;
      proc.next = null;
      proc.token = false;
      return this.sendToken(id, k);
    }
    return this.nextMsgId();
  }

  step(id: number): boolean {
    const proc = this.requireOnline(id);
    const message = proc.inbox.shift();
    if (message === undefined) return false;

    if (message.kind === "REQUEST") {
      const j = message.from;
      if (proc.token && proc.state === "idle") {
        proc.token = false;
        this.sendToken(id, j);
      } else if (proc.requesting) {
        if (proc.next === null) proc.next = j;
      } else {
        const msgId = this.nextMsgId();
        this.deliver(proc.last, { kind: "REQUEST", from: j, msgId });
      }
      proc.last = j;
      return true;
    }

    proc.token = true;
    if (proc.requesting) {
      proc.state = "held";
    } else if (proc.next !== null) {
      const k = proc.next;
      proc.next = null;
      proc.token = false;
      this.sendToken(id, k);
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      const proc = this.requireOnline(to);
      while (proc.inbox.length > 0) this.step(to);
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
    return this.requireProc(id).state;
  }

  hasToken(id: number): boolean {
    return this.requireProc(id).token;
  }

  lastOf(id: number): number {
    return this.requireProc(id).last;
  }

  nextOf(id: number): number | null {
    return this.requireProc(id).next;
  }

  holder(): number | null {
    const current = this.procs.filter((proc) => proc.token);
    return current.length === 1 ? current[0].id : null;
  }

  isRequesting(id: number): boolean {
    return this.requireProc(id).requesting;
  }

  inboxSize(id: number): number {
    return this.requireProc(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.requireProc(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.requireProc(id).online;
  }
}
