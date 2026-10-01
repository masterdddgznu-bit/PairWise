import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Bit, Message } from "./types.js";
import { BOProc } from "./process.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "./errors.js";

export type BenOrOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  faultBound?: number;
};

export class BenOr {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  private readonly n: number;
  private readonly f: number;
  private readonly majThreshold: number;
  private procs: BOProc[];
  private started = false;
  private seq = 0;

  constructor(opts: BenOrOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
    const n = opts.processCount ?? 6;
    const f = opts.faultBound ?? 1;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    if (!Number.isInteger(f) || f < 0) {
      throw new InvalidConfigError(`faultBound must be an integer >= 0, got ${f}`);
    }
    if (n < 5 * f + 1) {
      throw new InvalidConfigError(`requires n >= 5*f+1, got n=${n}, f=${f}`);
    }
    this.n = n;
    this.f = f;
    this.majThreshold = Math.floor((n + f) / 2);
    this.procs = Array.from({ length: n }, (_, i) => new BOProc(i));
  }

  reset(): void {
    this.procs = Array.from({ length: this.n }, (_, i) => new BOProc(i));
    this.started = false;
    this.seq = 0;
  }

  start(inputs: number[]): void {
    if (this.started) {
      throw new BusyError("consensus already started");
    }
    if (!Array.isArray(inputs) || inputs.length !== this.n) {
      throw new InvalidConfigError(
        `inputs must have length ${this.n}, got ${inputs?.length}`,
      );
    }
    for (const v of inputs) {
      if (v !== 0 && v !== 1) {
        throw new InvalidConfigError(`inputs must be bits, got ${v}`);
      }
    }
    this.procs.forEach((p, i) => {
      p.est = inputs[i] as Bit;
    });
    this.started = true;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!this.started || p.decided) return false;
    const msg = p.inbox.shift();
    if (msg !== undefined) {
      if (msg.round === p.round) this.deliver(p, msg);
      return true;
    }
    if (!p.sentR) {
      this.sendR(p);
      return true;
    }
    if (p.pendingP !== null && !p.sentP) {
      this.sendP(p);
      return true;
    }
    return false;
  }

  pump(): void {
    while (this.started && !this.procs.every((p) => p.decided)) {
      let progress = false;
      for (let i = 0; i < this.n; i++) {
        if (this.step(i)) progress = true;
      }
      if (!progress) break;
    }
  }

  estimate(id: number): Bit {
    return this.proc(id).est;
  }

  decided(id: number): boolean {
    return this.proc(id).decided;
  }

  decision(id: number): Bit | null {
    return this.proc(id).decision;
  }

  roundOf(id: number): number {
    return this.proc(id).round;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  faultBound(): number {
    return this.f;
  }

  processCount(): number {
    return this.n;
  }

  private proc(id: number): BOProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    this.clock.advance(1);
    const id = `m${this.seq}@t${this.clock.now()}`;
    this.seq += 1;
    return id;
  }

  private broadcast(from: number, msg: Message): void {
    for (const q of this.procs) {
      if (q.id !== from) q.inbox.push(msg);
    }
  }

  private sendR(p: BOProc): void {
    p.sentR = true;
    p.rCounts[p.est] += 1;
    p.rTotal += 1;
    this.broadcast(p.id, {
      kind: "R",
      round: p.round,
      from: p.id,
      value: p.est,
      msgId: this.nextMsgId(),
    });
    this.maybePrepareP(p);
  }

  private sendP(p: BOProc): void {
    p.sentP = true;
    const value = p.pendingP;
    if (value === null) return;
    if (value !== "?") p.pCounts[value] += 1;
    p.pTotal += 1;
    this.broadcast(p.id, {
      kind: "P",
      round: p.round,
      from: p.id,
      value,
      msgId: this.nextMsgId(),
    });
    this.maybeFinishRound(p);
  }

  private deliver(p: BOProc, msg: Message): void {
    if (msg.kind === "R") {
      p.rCounts[msg.value] += 1;
      p.rTotal += 1;
      this.maybePrepareP(p);
    } else {
      if (msg.value !== "?") p.pCounts[msg.value] += 1;
      p.pTotal += 1;
      this.maybeFinishRound(p);
    }
  }

  private maybePrepareP(p: BOProc): void {
    if (p.pendingP !== null || p.rTotal < this.n - this.f) return;
    if (p.rCounts[0] >= this.majThreshold) p.pendingP = 0;
    else if (p.rCounts[1] >= this.majThreshold) p.pendingP = 1;
    else p.pendingP = "?";
  }

  private maybeFinishRound(p: BOProc): void {
    if (p.pEvaluated || p.pTotal < this.n - this.f) return;
    p.pEvaluated = true;
    let chosen: Bit | null = null;
    if (p.pCounts[0] >= this.f + 1) chosen = 0;
    else if (p.pCounts[1] >= this.f + 1) chosen = 1;
    if (chosen !== null) {
      p.est = chosen;
      if (p.pCounts[chosen] >= this.majThreshold) {
        p.decided = true;
        p.decision = chosen;
      }
    } else {
      p.est = this.rng.nextBit();
    }
    if (!p.decided) p.beginNextRound();
  }
}
