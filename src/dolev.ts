import { VirtualClock } from "./clock.js";
import { DProc } from "./process.js";
import { makeSig, verifyEcho } from "./crypto.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import type { EchoMessage } from "./types.js";

export type DolevOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  sourceId?: number;
};

export class Dolev {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly f: number;
  private readonly source: number;
  private procs: DProc[] = [];
  private started = false;
  private broadcasted = false;
  private msgCounter = 0;

  constructor(opts: DolevOptions) {
    this.clock = opts.clock;
    this.n = opts.processCount ?? 4;
    this.f = opts.faultBound ?? 1;
    this.source = opts.sourceId ?? 0;
    if (!Number.isInteger(this.f) || this.f < 0) {
      throw new InvalidConfigError(`faultBound must be a non-negative integer, got ${this.f}`);
    }
    if (!Number.isInteger(this.n) || this.n < this.f + 2) {
      throw new InvalidConfigError(`processCount must be an integer >= faultBound + 2, got ${this.n}`);
    }
    if (!Number.isInteger(this.source) || this.source < 0 || this.source >= this.n) {
      throw new InvalidConfigError(`sourceId out of range: ${this.source}`);
    }
    this.reset();
  }

  reset(): void {
    this.procs = [];
    for (let i = 0; i < this.n; i++) this.procs.push(new DProc(i));
    this.started = false;
    this.broadcasted = false;
    this.msgCounter = 0;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    for (const p of this.procs) {
      p.inbox = [];
      p.round = 1;
      p.decided = false;
      p.decision = null;
      p.extracted = new Set<string>();
    }
    this.broadcasted = false;
    this.started = true;
  }

  broadcast(value: string): void {
    if (!this.started) throw new BusyError("not started");
    if (this.broadcasted) throw new BusyError("already broadcast");
    this.broadcasted = true;
    const src = this.procs[this.source];
    src.extracted.add(value);
    const signers = [this.source];
    const msg: EchoMessage = {
      kind: "ECHO",
      round: 1,
      from: this.source,
      value,
      signers,
      proof: [makeSig(this.source, value, 1, signers)],
      msgId: this.nextMsgId(),
    };
    for (const p of this.procs) {
      if (p.id !== this.source) p.inbox.push(msg);
    }
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox[0];
    if (!msg) return false;
    if (msg.round > p.round) return false;
    p.inbox.shift();
    if (msg.round < p.round) return true;
    if (!verifyEcho(msg, this.source)) return true;
    const isNew = !p.extracted.has(msg.value);
    p.extracted.add(msg.value);
    if (isNew && p.round <= this.f && !msg.signers.includes(p.id)) {
      const round = p.round + 1;
      const signers = [...msg.signers, p.id];
      const proof = signers.map((_, j) =>
        makeSig(signers[j], msg.value, round, signers.slice(0, j + 1)),
      );
      const out: EchoMessage = {
        kind: "ECHO",
        round,
        from: p.id,
        value: msg.value,
        signers,
        proof,
        msgId: this.nextMsgId(),
      };
      for (const q of this.procs) {
        if (q.id !== p.id) q.inbox.push(out);
      }
    }
    return true;
  }

  pump(): void {
    if (!this.started) return;
    for (;;) {
      let progress = false;
      for (const p of this.procs) {
        if (!p.decided && this.step(p.id)) progress = true;
      }
      if (progress) continue;
      let allDecided = true;
      for (const p of this.procs) {
        if (!p.decided) {
          this.endRound(p.id);
          if (!p.decided) allDecided = false;
        }
      }
      if (allDecided) return;
    }
  }

  private endRound(id: number): void {
    const p = this.procs[id];
    if (p.decided) return;
    p.round += 1;
    if (p.round > this.f + 1) {
      p.decided = true;
      p.decision = p.extracted.size === 1 ? [...p.extracted][0] : "⊥";
    }
  }

  decided(id: number): boolean { return this.proc(id).decided; }
  decision(id: number): string | null { return this.proc(id).decision; }
  extractedOf(id: number): string[] {
    return [...this.proc(id).extracted].sort();
  }
  roundOf(id: number): number { return this.proc(id).round; }
  inboxSize(id: number): number { return this.proc(id).inbox.length; }
  sourceId(): number { return this.source; }
  faultBound(): number { return this.f; }
  processCount(): number { return this.n; }

  private proc(id: number): DProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    return `m${this.msgCounter++}`;
  }
}
