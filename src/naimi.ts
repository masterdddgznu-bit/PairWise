import { VirtualClock } from "./clock.js";
import { NProc } from "./process.js";
import type { ProcState } from "./types.js";
import type { Message } from "./types.js";
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
    const count = opts.processCount ?? 3;
    if (!Number.isInteger(count) || count < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2: ${count}`);
    }
    this.clock = opts.clock;
    this.procs = [];
    for (let id = 0; id < count; id++) {
      const proc = new NProc(id, 0);
      proc.token = id === 0;
      this.procs.push(proc);
    }
  }

  private resolve(id: number): NProc {
    const proc = this.procs[id];
    if (proc === undefined) {
      throw new InvalidProcessError(id);
    }
    return proc;
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return String(this.msgCounter);
  }

  private deliver(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
  }

  request(id: number): string {
    const proc = this.resolve(id);
    if (!proc.online) {
      throw new OfflineError(id);
    }
    if (proc.state !== "idle") {
      throw new BusyError(id);
    }
    const msgId = this.nextMsgId();
    proc.requesting = true;
    if (proc.token) {
      proc.state = "held";
      return msgId;
    }
    proc.state = "waiting";
    this.deliver(proc.last, { kind: "REQUEST", from: id, msgId });
    proc.last = id;
    return msgId;
  }

  release(id: number): string {
    const proc = this.resolve(id);
    if (proc.state !== "held") {
      throw new NotHolderError(id);
    }
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const msgId = this.nextMsgId();
    proc.state = "idle";
    proc.requesting = false;
    if (proc.next !== null) {
      const target = proc.next;
      proc.next = null;
      proc.token = false;
      this.deliver(target, { kind: "TOKEN", from: id, msgId });
    }
    return msgId;
  }

  private handToken(from: NProc, to: number): string {
    const msgId = this.nextMsgId();
    from.token = false;
    this.deliver(to, { kind: "TOKEN", from: from.id, msgId });
    return msgId;
  }

  step(id: number): boolean {
    const proc = this.resolve(id);
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const msg = proc.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    if (msg.kind === "REQUEST") {
      const requester = msg.from;
      if (proc.token && proc.state === "idle") {
        this.handToken(proc, requester);
      } else if (proc.requesting) {
        if (proc.next === null) {
          proc.next = requester;
        }
      } else {
        this.deliver(proc.last, {
          kind: "REQUEST",
          from: requester,
          msgId: this.nextMsgId(),
        });
      }
      proc.last = requester;
    } else {
      proc.token = true;
      if (proc.requesting) {
        proc.state = "held";
      } else if (proc.next !== null) {
        const target = proc.next;
        proc.next = null;
        this.handToken(proc, target);
      }
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain target inbox
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const proc of this.procs) {
        if (!proc.online || proc.inbox.length === 0) {
          continue;
        }
        this.step(proc.id);
        progressed = true;
      }
    }
  }

  stateOf(id: number): ProcState {
    return this.resolve(id).state;
  }

  hasToken(id: number): boolean {
    return this.resolve(id).token;
  }

  lastOf(id: number): number {
    return this.resolve(id).last;
  }

  nextOf(id: number): number | null {
    return this.resolve(id).next;
  }

  holder(): number | null {
    for (const proc of this.procs) {
      if (proc.token) {
        return proc.id;
      }
    }
    return null;
  }

  isRequesting(id: number): boolean {
    return this.resolve(id).requesting;
  }

  inboxSize(id: number): number {
    return this.resolve(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.resolve(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.resolve(id).online;
  }
}
