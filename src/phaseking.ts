import { VirtualClock } from "./clock.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "./errors.js";
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
  private msgSeq = 0;

  constructor(opts: PhaseKingOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    const f = opts.faultBound ?? 1;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 2, got ${n}`,
      );
    }
    if (!Number.isInteger(f) || f < 0) {
      throw new InvalidConfigError(
        `faultBound must be an integer >= 0, got ${f}`,
      );
    }
    if (n < 3 * f + 1) {
      throw new InvalidConfigError(`require n >= 3f+1, got n=${n}, f=${f}`);
    }
    this.n = n;
    this.f = f;
    this.procs = this.freshProcs();
  }

  private freshProcs(): PKProc[] {
    return Array.from({ length: this.n }, (_, i) => new PKProc(i));
  }

  private proc(id: number): PKProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  reset(): void {
    this.started = false;
    this.msgSeq = 0;
    this.procs = this.freshProcs();
  }

  start(inputs: number[]): void {
    if (this.started) {
      throw new BusyError("already started");
    }
    if (
      inputs.length !== this.n ||
      inputs.some((v) => v !== 0 && v !== 1)
    ) {
      throw new InvalidConfigError(
        `inputs must be ${this.n} bits, got [${inputs.join(",")}]`,
      );
    }
    for (let i = 0; i < this.n; i++) {
      this.procs[i].pref = inputs[i] as Bit;
    }
    this.started = true;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg !== undefined) {
      this.deliver(p, msg);
      return true;
    }
    if (!this.started || p.decided || p.phase > this.f) {
      return false;
    }
    if (!p.sentPropose) {
      this.sendPropose(p);
      return true;
    }
    if (!p.sentKing && this.kingOf(p.phase) === p.id) {
      this.sendKing(p);
      return true;
    }
    return false;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < this.n; i++) {
        if (this.step(i)) {
          progress = true;
        }
      }
    }
  }

  private nextMsgId(): string {
    const id = `m${this.msgSeq}@${this.clock.now()}`;
    this.msgSeq += 1;
    return id;
  }

  private sendPropose(p: PKProc): void {
    p.sentPropose = true;
    for (let to = 0; to < this.n; to++) {
      if (to === p.id) continue;
      this.procs[to].inbox.push({
        kind: "PROPOSE",
        phase: p.phase,
        from: p.id,
        value: p.pref,
        msgId: this.nextMsgId(),
      });
    }
    this.tally(p, p.phase, p.pref);
  }

  private sendKing(p: PKProc): void {
    p.sentKing = true;
    const maj = p.majorities.get(p.phase);
    const value: Bit = maj ? maj.value : p.pref;
    for (let to = 0; to < this.n; to++) {
      if (to === p.id) continue;
      this.procs[to].inbox.push({
        kind: "KING",
        phase: p.phase,
        from: p.id,
        value,
        msgId: this.nextMsgId(),
      });
    }
    p.kingValues.set(p.phase, value);
    this.maybeAdvance(p);
  }

  private deliver(p: PKProc, msg: Message): void {
    if (msg.kind === "PROPOSE") {
      this.tally(p, msg.phase, msg.value);
    } else {
      p.kingValues.set(msg.phase, msg.value);
      this.maybeAdvance(p);
    }
  }

  private tally(p: PKProc, phase: number, value: Bit): void {
    let bag = p.proposals.get(phase);
    if (!bag) {
      bag = { zero: 0, one: 0 };
      p.proposals.set(phase, bag);
    }
    if (value === 0) {
      bag.zero += 1;
    } else {
      bag.one += 1;
    }
    if (!p.majorities.has(phase) && bag.zero + bag.one >= this.n - this.f) {
      const majValue: Bit = bag.one >= bag.zero ? 1 : 0;
      p.majorities.set(phase, {
        value: majValue,
        mult: Math.max(bag.zero, bag.one),
      });
    }
    this.maybeAdvance(p);
  }

  private maybeAdvance(p: PKProc): void {
    if (p.decided || p.phase > this.f) {
      return;
    }
    const maj = p.majorities.get(p.phase);
    const king = p.kingValues.get(p.phase);
    if (!maj || king === undefined) {
      return;
    }
    p.pref = maj.mult > this.n / 2 + this.f ? maj.value : king;
    p.phase += 1;
    p.sentPropose = false;
    p.sentKing = false;
    if (p.phase > this.f) {
      p.decided = true;
    }
  }

  preference(id: number): Bit {
    return this.proc(id).pref;
  }

  decided(id: number): boolean {
    return this.proc(id).decided;
  }

  decision(id: number): Bit | null {
    const p = this.proc(id);
    return p.decided ? p.pref : null;
  }

  phaseOf(id: number): number {
    return this.proc(id).phase;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  kingOf(phase: number): number {
    return phase % this.n;
  }

  faultBound(): number {
    return this.f;
  }

  processCount(): number {
    return this.n;
  }
}
