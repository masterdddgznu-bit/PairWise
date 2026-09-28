import { VirtualClock } from "./clock.js";
import { InvalidProcessError, InvalidPayloadError, OfflineError } from "./errors.js";
import { VProc } from "./process.js";
import type { Delivered, Vector } from "./types.js";
import { merge, ready } from "./vector.js";

export type VectorCbOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class VectorCb {
  readonly clock: VirtualClock;
  private readonly procs: VProc[];
  private nextMsgId = 1;

  constructor(opts: VectorCbOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 3;
    this.procs = Array.from({ length: n }, (_, id) => new VProc(id, n));
  }

  broadcast(from: number, payload: string): string {
    if (!payload) {
      throw new InvalidPayloadError();
    }
    const sender = this.proc(from);
    if (!sender.online) {
      throw new OfflineError(from);
    }
    sender.clock[from] += 1;
    const msg = {
      msgId: String(this.nextMsgId++),
      from,
      payload,
      vt: [...sender.clock],
    };
    for (const proc of this.procs) {
      if (proc.id !== from && proc.online) {
        proc.inbox.push(msg);
      }
    }
    sender.delivered.push({ msgId: msg.msgId, from, payload });
    return msg.msgId;
  }

  step(to: number): boolean {
    const proc = this.proc(to);
    if (!proc.online) {
      throw new OfflineError(to);
    }
    const head = proc.inbox.shift();
    if (head !== undefined) {
      if (ready(head.vt, proc.clock, head.from)) {
        this.deliverTo(proc, head);
      } else {
        proc.buffer.push(head);
      }
      return true;
    }
    let chosen = -1;
    for (let i = 0; i < proc.buffer.length; i++) {
      const msg = proc.buffer[i];
      if (
        ready(msg.vt, proc.clock, msg.from) &&
        (chosen === -1 || Number(msg.msgId) < Number(proc.buffer[chosen].msgId))
      ) {
        chosen = i;
      }
    }
    if (chosen === -1) return false;
    this.deliverTo(proc, proc.buffer[chosen]);
    proc.buffer.splice(chosen, 1);
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain until no progress
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const proc of this.procs) {
        if (proc.online && this.step(proc.id)) {
          progressed = true;
        }
      }
    }
  }

  delivered(id: number): Delivered[] {
    return this.proc(id).delivered.map((d) => ({ ...d }));
  }

  clockOf(id: number): Vector {
    return [...this.proc(id).clock];
  }

  buffered(id: number): string[] {
    return this.proc(id)
      .buffer.map((msg) => msg.msgId)
      .sort((a, b) => Number(a) - Number(b));
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

  private proc(id: number): VProc {
    const proc = this.procs[id];
    if (!proc) {
      throw new InvalidProcessError(id);
    }
    return proc;
  }

  private deliverTo(proc: VProc, msg: { msgId: string; from: number; payload: string; vt: Vector }): void {
    proc.delivered.push({ msgId: msg.msgId, from: msg.from, payload: msg.payload });
    proc.clock = merge(proc.clock, msg.vt);
  }
}
