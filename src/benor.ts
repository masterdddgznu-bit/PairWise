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
  private procs: BOProc[];
  private started = false;
  private msgSeq = 0;

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
      throw new InvalidConfigError(`require n >= 5*f+1, got n=${n}, f=${f}`);
    }
    this.n = n;
    this.f = f;
    this.procs = Array.from({ length: n }, (_, i) => new BOProc(i));
  }

  reset(): void {
    this.procs = Array.from({ length: this.n }, (_, i) => new BOProc(i));
    this.started = false;
    this.msgSeq = 0;
  }

  start(inputs: number[]): void {
    if (this.started) throw new BusyError("already started");
    if (
      !Array.isArray(inputs) ||
      inputs.length !== this.n ||
      !inputs.every((v) => v === 0 || v === 1)
    ) {
      throw new InvalidConfigError(`inputs must be an array of ${this.n} bits`);
    }
    inputs.forEach((v, i) => {
      this.procs[i].est = v as Bit;
    });
    this.started = true;
  }

  private get quorum(): number {
    return this.n - this.f;
  }

  private get majThreshold(): number {
    return Math.floor((this.n + this.f) / 2);
  }

  private nextMsgId(): string {
    this.msgSeq += 1;
    return `m${this.msgSeq}`;
  }

  private broadcast(msg: { kind: "R" | "P"; round: number; from: number; value: Bit | "?" }): void {
    for (const p of this.procs) {
      if (p.id === msg.from) continue;
      p.inbox.push({ ...msg, msgId: this.nextMsgId() } as Message);
    }
    this.clock.advance(1);
  }

  private onRBagUpdate(p: BOProc): void {
    if (p.preparedP !== null || p.rCount < this.quorum) return;
    const ones = p.rBits;
    const zeros = p.rCount - p.rBits;
    if (ones >= this.majThreshold) p.preparedP = 1;
    else if (zeros >= this.majThreshold) p.preparedP = 0;
    else p.preparedP = "?";
  }

  private onPBagUpdate(p: BOProc): void {
    if (p.pCount < this.quorum) return;
    const ones = p.pBits;
    const zeros = p.pCount - p.pUnknown - p.pBits;
    let next: Bit | null = null;
    if (ones >= this.f + 1 && ones >= zeros) next = 1;
    else if (zeros >= this.f + 1) next = 0;
    if (next !== null) {
      p.est = next;
      const votes = next === 1 ? ones : zeros;
      if (votes >= this.majThreshold) {
        p.decided = true;
        p.decision = next;
      }
    } else {
      p.est = this.rng.nextBit();
    }
    if (!p.decided) {
      p.round += 1;
      p.resetRound();
    }
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!this.started || p.decided) return false;

    const msg = p.inbox.shift();
    if (msg !== undefined) {
      if (msg.round === p.round) {
        if (msg.kind === "R") {
          p.addR(msg.value);
          this.onRBagUpdate(p);
        } else {
          p.addP(msg.value);
          this.onPBagUpdate(p);
        }
      }
      return true;
    }

    if (!p.sentR) {
      p.sentR = true;
      p.addR(p.est);
      this.onRBagUpdate(p);
      this.broadcast({ kind: "R", round: p.round, from: p.id, value: p.est });
      return true;
    }

    if (p.preparedP !== null && !p.sentP) {
      p.sentP = true;
      const value = p.preparedP;
      this.broadcast({ kind: "P", round: p.round, from: p.id, value });
      p.addP(value);
      this.onPBagUpdate(p);
      return true;
    }

    return false;
  }

  pump(): void {
    if (!this.started) return;
    for (;;) {
      if (this.procs.every((p) => p.decided)) return;
      let progress = false;
      for (const p of this.procs) {
        if (this.step(p.id)) progress = true;
      }
      if (!progress) return;
    }
  }

  private proc(id: number): BOProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
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
}
