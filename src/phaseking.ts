import { VirtualClock } from "./clock.js";
import { InvalidConfigError, InvalidProcessError, BusyError } from "./errors.js";
import { PKProc } from "./process.js";
import type { Bit, Message } from "./types.js";

export type PhaseKingOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
};

export class PhaseKing {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly f: number;
  private procs: PKProc[];
  private started = false;
  private msgCounter = 0;

  constructor(opts: PhaseKingOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    const f = opts.faultBound ?? 1;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    if (!Number.isInteger(f) || f < 0) {
      throw new InvalidConfigError(`faultBound must be an integer >= 0, got ${f}`);
    }
    if (n < 3 * f + 1) {
      throw new InvalidConfigError(`require n >= 3f+1, got n=${n}, f=${f}`);
    }
    this.n = n;
    this.f = f;
    this.procs = [];
    for (let i = 0; i < n; i++) this.procs.push(new PKProc(i));
  }

  reset(): void {
    this.started = false;
    this.msgCounter = 0;
    for (const p of this.procs) p.resetAll(0);
  }

  start(inputs: number[]): void {
    if (this.started) throw new BusyError("already started");
    if (!Array.isArray(inputs) || inputs.length !== this.n) {
      throw new InvalidConfigError(`expected ${this.n} inputs, got ${inputs?.length}`);
    }
    for (const v of inputs) {
      if (v !== 0 && v !== 1) {
        throw new InvalidConfigError(`input must be 0 or 1, got ${v}`);
      }
    }
    inputs.forEach((v, i) => this.procs[i].resetAll(v as Bit));
    this.started = true;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!this.started || p.decided) return false;
    const msg = p.inbox.shift();
    if (msg !== undefined) {
      this.handleMessage(p, msg);
      return true;
    }
    if (!p.sentPropose) {
      p.sentPropose = true;
      p.counts[p.pref] += 1;
      this.broadcast(p, { kind: "PROPOSE", phase: p.phase, value: p.pref });
      this.maybeAdvance(p);
      return true;
    }
    if (p.id === this.kingOf(p.phase) && !p.sentKing) {
      p.sentKing = true;
      const value = this.totalCount(p) >= this.n - this.f ? this.majority(p) : p.pref;
      p.gotKing = true;
      p.kingValue = value;
      this.broadcast(p, { kind: "KING", phase: p.phase, value });
      this.maybeAdvance(p);
      return true;
    }
    return false;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (let id = 0; id < this.n; id++) {
        if (this.step(id)) progress = true;
      }
    }
  }

  preference(id: number): Bit { return this.proc(id).pref; }
  decided(id: number): boolean { return this.proc(id).decided; }
  decision(id: number): Bit | null {
    const p = this.proc(id);
    return p.decided ? p.pref : null;
  }
  phaseOf(id: number): number { return this.proc(id).phase; }
  inboxSize(id: number): number { return this.proc(id).inbox.length; }
  kingOf(phase: number): number { return phase % this.n; }
  faultBound(): number { return this.f; }
  processCount(): number { return this.n; }

  private proc(id: number): PKProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private totalCount(p: PKProc): number {
    return p.counts[0] + p.counts[1];
  }

  private majority(p: PKProc): Bit {
    return p.counts[1] >= p.counts[0] ? 1 : 0;
  }

  private broadcast(from: PKProc, m: { kind: Message["kind"]; phase: number; value: Bit }): void {
    for (const q of this.procs) {
      if (q.id === from.id) continue;
      q.inbox.push({ ...m, from: from.id, msgId: `m${this.msgCounter++}` });
    }
  }

  private handleMessage(p: PKProc, msg: Message): void {
    if (msg.phase < p.phase) return;
    if (msg.phase > p.phase) {
      p.deferred.push(msg);
      return;
    }
    if (msg.kind === "PROPOSE") {
      p.counts[msg.value] += 1;
    } else {
      p.gotKing = true;
      p.kingValue = msg.value;
    }
    this.maybeAdvance(p);
  }

  private maybeAdvance(p: PKProc): void {
    if (p.decided || !p.gotKing) return;
    if (this.totalCount(p) < this.n - this.f) return;
    const mult = Math.max(p.counts[0], p.counts[1]);
    p.pref = mult > this.n / 2 + this.f ? this.majority(p) : p.kingValue;
    p.phase += 1;
    p.resetPhaseState();
    if (p.phase > this.f) {
      p.decided = true;
      p.deferred = [];
      return;
    }
    const ready = p.deferred.filter((m) => m.phase === p.phase);
    p.deferred = p.deferred.filter((m) => m.phase > p.phase);
    p.inbox = [...ready, ...p.inbox];
  }
}
