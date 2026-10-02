import { VirtualClock } from "./clock.js";
import { SProc } from "./process.js";
import { makeSig, verifySm } from "./crypto.js";
import { choice } from "./choice.js";
import { DEFAULT_ORDER, type SmMessage } from "./types.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";

export type SignedMsgOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  commanderId?: number;
};

export class SignedMsg {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly f: number;
  private readonly commander: number;
  private procs: SProc[] = [];
  private started = false;
  private commanded = false;
  private msgCounter = 0;

  constructor(opts: SignedMsgOptions) {
    this.clock = opts.clock;
    this.n = opts.processCount ?? 4;
    this.f = opts.faultBound ?? 1;
    this.commander = opts.commanderId ?? 0;
    if (!Number.isInteger(this.n) || this.n < 1) {
      throw new InvalidConfigError(`invalid process count: ${this.n}`);
    }
    if (!Number.isInteger(this.f) || this.f < 0) {
      throw new InvalidConfigError(`invalid fault bound: ${this.f}`);
    }
    if (this.n < this.f + 2) {
      throw new InvalidConfigError(`need n >= f+2, got n=${this.n}, f=${this.f}`);
    }
    if (!Number.isInteger(this.commander) || this.commander < 0 || this.commander >= this.n) {
      throw new InvalidConfigError(`invalid commander id: ${this.commander}`);
    }
    this.initProcs();
  }

  private initProcs(): void {
    this.procs = Array.from({ length: this.n }, (_, id) => new SProc(id));
  }

  private proc(id: number): SProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return `m${this.msgCounter}`;
  }

  reset(): void {
    this.started = false;
    this.commanded = false;
    this.msgCounter = 0;
    this.initProcs();
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.reset();
    this.started = true;
  }

  command(value: string): void {
    if (!this.started) throw new BusyError("not started");
    if (this.commanded) throw new BusyError("already commanded");
    this.commanded = true;
    const commander = this.procs[this.commander];
    commander.values.add(value);
    const signers = [this.commander];
    const proof = [makeSig(this.commander, value, signers)];
    for (const p of this.procs) {
      if (p.id === this.commander) continue;
      p.inbox.push({
        kind: "SM",
        value,
        signers: [...signers],
        proof: [...proof],
        from: this.commander,
        msgId: this.nextMsgId(),
      });
    }
  }

  private deliver(p: SProc, msg: SmMessage): void {
    if (!verifySm(msg, this.commander)) return;
    p.values.add(msg.value);
    if (msg.signers.length <= this.f && !msg.signers.includes(p.id)) {
      const signers = [...msg.signers, p.id];
      const proof = [...msg.proof, makeSig(p.id, msg.value, signers)];
      for (const q of this.procs) {
        if (signers.includes(q.id)) continue;
        q.inbox.push({
          kind: "SM",
          value: msg.value,
          signers: [...signers],
          proof: [...proof],
          from: p.id,
          msgId: this.nextMsgId(),
        });
      }
    }
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    this.deliver(p, msg);
    return true;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        while (p.inbox.length > 0) {
          this.step(p.id);
          progress = true;
        }
      }
    }
    for (const p of this.procs) {
      if (!p.decided) {
        p.decision = p.values.size === 0 ? DEFAULT_ORDER : choice([...p.values]);
        p.decided = true;
      }
    }
  }

  decided(id: number): boolean {
    return this.proc(id).decided;
  }

  decision(id: number): string | null {
    return this.proc(id).decision;
  }

  valuesOf(id: number): string[] {
    return [...this.proc(id).values].sort();
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  commanderId(): number {
    return this.commander;
  }

  faultBound(): number {
    return this.f;
  }

  processCount(): number {
    return this.n;
  }
}
