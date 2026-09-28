import { VirtualClock } from "./clock.js";
import type { Message, ProcState } from "./types.js";
import { Token } from "./token.js";
import { SProc } from "./process.js";
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
  private counter = 0;

  constructor(opts: SuzukOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 3;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2: ${String(n)}`);
    }
    this.n = n;
    this.procs = Array.from({ length: n }, (_, id) => new SProc(id, n));
    this.procs[0].token = new Token(n);
  }

  private nextMsgId(): string {
    this.counter += 1;
    return String(this.counter);
  }

  private proc(id: number): SProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private requireOnline(id: number): SProc {
    const p = this.proc(id);
    if (!p.online) {
      throw new OfflineError(id);
    }
    return p;
  }

  private forwardToken(from: SProc, to: number, token: Token, msgId: string): void {
    const snapshot = token.clone();
    from.token = null;
    const message: Message = {
      kind: "TOKEN",
      from: from.id,
      ln: snapshot.ln,
      queue: snapshot.queue,
      msgId,
    };
    this.procs[to].inbox.push(message);
  }

  request(id: number): string {
    const p = this.requireOnline(id);
    if (p.state !== "idle") {
      throw new BusyError(id);
    }
    p.rn[id] += 1;
    const msgId = this.nextMsgId();
    if (p.token) {
      p.state = "held";
      return msgId;
    }
    p.state = "waiting";
    for (const target of this.procs) {
      if (target.id !== id && target.online) {
        target.inbox.push({ kind: "REQUEST", from: id, seq: p.rn[id], msgId });
      }
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
    const token = p.token;
    if (!token) {
      throw new NotHolderError(id);
    }
    token.ln[id] = p.rn[id];
    for (let j = 0; j < this.n; j++) {
      if (j !== id && p.rn[j] === token.ln[j] + 1 && !token.queue.includes(j)) {
        token.queue.push(j);
      }
    }
    p.state = "idle";
    const msgId = this.nextMsgId();
    if (token.queue.length > 0) {
      const next = token.queue.shift() as number;
      this.forwardToken(p, next, token, msgId);
    }
    return msgId;
  }

  step(id: number): boolean {
    const p = this.requireOnline(id);
    const message = p.inbox.shift();
    if (!message) {
      return false;
    }
    if (message.kind === "REQUEST") {
      p.rn[message.from] = Math.max(p.rn[message.from], message.seq);
      const heldToken = p.token;
      if (
        heldToken &&
        p.state === "idle" &&
        p.rn[message.from] === heldToken.ln[message.from] + 1
      ) {
        this.forwardToken(p, message.from, heldToken, this.nextMsgId());
      }
      return true;
    }
    const token = new Token(this.n);
    token.ln = [...message.ln];
    token.queue = [...message.queue];
    p.token = token;
    if (p.state === "waiting") {
      p.state = "held";
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
      for (const p of this.procs) {
        if (p.online && this.step(p.id)) {
          progressed = true;
        }
      }
    }
  }

  stateOf(id: number): ProcState {
    return this.proc(id).state;
  }

  holder(): number | null {
    for (const p of this.procs) {
      if (p.token) {
        return p.id;
      }
    }
    return null;
  }

  hasToken(id: number): boolean {
    return this.proc(id).token !== null;
  }

  rnOf(id: number): number[] {
    return [...this.proc(id).rn];
  }

  tokenLn(): number[] | null {
    for (const p of this.procs) {
      if (p.token) {
        return [...p.token.ln];
      }
    }
    return null;
  }

  tokenQueue(): number[] | null {
    for (const p of this.procs) {
      if (p.token) {
        return [...p.token.queue];
      }
    }
    return null;
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
