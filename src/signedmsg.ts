import { VirtualClock } from "./clock.js";
import { SProc } from "./process.js";
import { makeSig, verifySm } from "./crypto.js";
import { choice } from "./choice.js";
import { DEFAULT_ORDER } from "./types.js";
import type { SmMessage } from "./types.js";
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
    if (this.f < 0) throw new InvalidConfigError(`faultBound must be >= 0, got ${this.f}`);
    if (this.n < this.f + 2) {
      throw new InvalidConfigError(`processCount ${this.n} < faultBound ${this.f} + 2`);
    }
    if (this.commander < 0 || this.commander >= this.n) {
      throw new InvalidConfigError(`invalid commanderId: ${this.commander}`);
    }
    this.clearProcs();
  }

  private clearProcs(): void {
    this.procs = Array.from({ length: this.n }, (_, i) => new SProc(i));
  }

  private proc(id: number): SProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) throw new InvalidProcessError(id);
    return this.procs[id];
  }

  private nextMsgId(): string {
    return `m${++this.msgCounter}`;
  }

  private deliver(to: number, msg: SmMessage): void {
    this.procs[to].inbox.push(msg);
  }

  private receive(p: SProc, msg: SmMessage): void {
    if (!verifySm(msg, this.commander)) return;
    p.values.add(msg.value);
    if (msg.signers.length <= this.f && !msg.signers.includes(p.id)) {
      const signers = [...msg.signers, p.id];
      const proof = [...msg.proof, makeSig(p.id, msg.value, signers)];
      for (let to = 0; to < this.n; to++) {
        if (signers.includes(to)) continue;
        this.deliver(to, { kind: "SM", value: msg.value, signers, proof, from: p.id, msgId: this.nextMsgId() });
      }
    }
  }

  reset(): void {
    this.started = false;
    this.commanded = false;
    this.clearProcs();
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.started = true;
    this.commanded = false;
    this.clearProcs();
  }

  command(value: string): void {
    if (!this.started) throw new BusyError("not started");
    if (this.commanded) throw new BusyError("already commanded");
    this.commanded = true;
    const signers = [this.commander];
    const proof = [makeSig(this.commander, value, signers)];
    this.procs[this.commander].values.add(value);
    for (let to = 0; to < this.n; to++) {
      if (to === this.commander) continue;
      this.deliver(to, { kind: "SM", value, signers, proof, from: this.commander, msgId: this.nextMsgId() });
    }
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    this.receive(p, msg);
    return true;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < this.n; i++) {
        while (this.step(i)) progress = true;
      }
    }
    for (const p of this.procs) {
      p.decision = p.values.size === 0 ? DEFAULT_ORDER : choice([...p.values]);
      p.decided = true;
    }
  }

  decided(id: number): boolean { return this.proc(id).decided; }
  decision(id: number): string | null { return this.proc(id).decision; }
  valuesOf(id: number): string[] { return [...this.proc(id).values].sort(); }
  inboxSize(id: number): number { return this.proc(id).inbox.length; }
  commanderId(): number { return this.commander; }
  faultBound(): number { return this.f; }
  processCount(): number { return this.n; }
}
