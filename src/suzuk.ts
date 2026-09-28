import { VirtualClock } from "./clock.js";
import { SProc } from "./process.js";
import { Token } from "./token.js";
import type { Message, ProcState } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  NotHolderError,
  OfflineError,
} from "./errors.js";

export type SuzukOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Suzuk {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly procs: SProc[];
  private nextMsgId = 1;

  constructor(opts: SuzukOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 3;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2: ${n}`);
    }
    this.n = n;
    this.procs = Array.from({ length: n }, (_, id) => new SProc(id, n));
    this.procs[0].token = new Token(n);
  }

  private validId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private proc(id: number): SProc {
    this.validId(id);
    return this.procs[id];
  }

  private online(id: number): SProc {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    return p;
  }

  private allocMsgId(): string {
    return String(this.nextMsgId++);
  }

  private holderProc(): SProc | null {
    for (const p of this.procs) {
      if (p.token !== null) return p;
    }
    return null;
  }

  private sendToken(holder: SProc, to: number): string {
    const token = holder.token;
    if (token === null) throw new NotHolderError(holder.id);
    const msgId = this.allocMsgId();
    const ln = [...token.ln];
    const queue = [...token.queue];
    holder.token = null;
    const message: Message = { kind: "TOKEN", from: holder.id, ln, queue, msgId };
    this.procs[to].inbox.push(message);
    return msgId;
  }

  request(id: number): string {
    const p = this.online(id);
    if (p.state !== "idle") throw new BusyError(id);
    p.rn[id] += 1;
    const msgId = this.allocMsgId();
    if (p.token !== null) {
      p.state = "held";
      return msgId;
    }
    p.state = "waiting";
    const seq = p.rn[id];
    for (const other of this.procs) {
      if (other.id !== id && other.online) {
        other.inbox.push({ kind: "REQUEST", from: id, seq, msgId });
      }
    }
    return msgId;
  }

  release(id: number): string {
    const p = this.proc(id);
    if (p.state !== "held") throw new NotHolderError(id);
    if (!p.online) throw new OfflineError(id);
    const token = p.token;
    if (token === null) throw new NotHolderError(id);
    token.ln[id] = p.rn[id];
    for (let j = 0; j < this.n; j += 1) {
      if (j !== id && p.rn[j] === token.ln[j] + 1 && !token.queue.includes(j)) {
        token.queue.push(j);
      }
    }
    p.state = "idle";
    if (token.queue.length === 0) return this.allocMsgId();
    const k = token.queue.shift() as number;
    return this.sendToken(p, k);
  }

  step(id: number): boolean {
    const p = this.online(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    if (msg.kind === "REQUEST") {
      p.rn[msg.from] = Math.max(p.rn[msg.from], msg.seq);
      if (
        p.token !== null &&
        p.state === "idle" &&
        p.rn[msg.from] === p.token.ln[msg.from] + 1
      ) {
        this.sendToken(p, msg.from);
      }
      return true;
    }
    p.token = Token.fromArrays(msg.ln, msg.queue);
    if (p.state === "waiting") p.state = "held";
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

  holder(): number | null {
    const h = this.holderProc();
    return h === null ? null : h.id;
  }

  hasToken(id: number): boolean {
    return this.proc(id).token !== null;
  }

  rnOf(id: number): number[] {
    return [...this.proc(id).rn];
  }

  tokenLn(): number[] | null {
    const h = this.holderProc();
    return h === null || h.token === null ? null : [...h.token.ln];
  }

  tokenQueue(): number[] | null {
    const h = this.holderProc();
    return h === null || h.token === null ? null : [...h.token.queue];
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
