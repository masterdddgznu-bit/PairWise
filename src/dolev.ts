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

const DEFAULT_DECISION = "⊥";

export class Dolev {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly f: number;
  private readonly source: number;
  private procs: DProc[] = [];
  private started = false;
  private broadcastDone = false;
  private seq = 0;

  constructor(opts: DolevOptions) {
    const n = opts.processCount ?? 4;
    const f = opts.faultBound ?? 1;
    const source = opts.sourceId ?? 0;
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidConfigError(`invalid processCount: ${n}`);
    }
    if (!Number.isInteger(f) || f < 0) {
      throw new InvalidConfigError(`invalid faultBound: ${f}`);
    }
    if (n < f + 2) {
      throw new InvalidConfigError(`processCount ${n} must be >= faultBound + 2 (${f + 2})`);
    }
    if (!Number.isInteger(source) || source < 0 || source >= n) {
      throw new InvalidConfigError(`invalid sourceId: ${source}`);
    }
    this.clock = opts.clock;
    this.n = n;
    this.f = f;
    this.source = source;
    this.initProcs();
  }

  private initProcs(): void {
    this.procs = Array.from({ length: this.n }, (_, i) => new DProc(i));
  }

  private proc(id: number): DProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    return `m${this.seq++}`;
  }

  private deliver(msg: EchoMessage, except: number): void {
    for (const p of this.procs) {
      if (p.id !== except) p.inbox.push(msg);
    }
  }

  reset(): void {
    this.started = false;
    this.broadcastDone = false;
    this.seq = 0;
    this.initProcs();
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.reset();
    this.started = true;
  }

  broadcast(value: string): void {
    if (!this.started) throw new BusyError("not started");
    if (this.broadcastDone) throw new BusyError("already broadcast");
    this.broadcastDone = true;
    const src = this.procs[this.source];
    src.extracted.add(value);
    src.forwarded.add(value);
    this.deliver(
      {
        kind: "ECHO",
        round: 1,
        from: this.source,
        value,
        signers: [this.source],
        proof: [makeSig(this.source, value, 1, [this.source])],
        msgId: this.nextMsgId(),
      },
      this.source,
    );
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (!msg) return false;
    if (!verifyEcho(msg, this.source)) return true;
    p.extracted.add(msg.value);
    if (p.round <= this.f && !p.forwarded.has(msg.value)) {
      p.forwarded.add(msg.value);
      if (!msg.signers.includes(p.id)) {
        const signers = [...msg.signers, p.id];
        const round = p.round + 1;
        const proof = signers.map((pid, i) =>
          makeSig(pid, msg.value, round, signers.slice(0, i + 1)),
        );
        this.deliver(
          {
            kind: "ECHO",
            round,
            from: p.id,
            value: msg.value,
            signers,
            proof,
            msgId: this.nextMsgId(),
          },
          p.id,
        );
      }
    }
    return true;
  }

  private endRound(id: number): void {
    const p = this.proc(id);
    if (p.decided) return;
    p.round += 1;
    if (p.round > this.f + 1) {
      p.decided = true;
      p.decision = p.extracted.size === 1 ? [...p.extracted][0] : DEFAULT_DECISION;
    }
  }

  pump(): void {
    for (;;) {
      let progress = false;
      for (const p of this.procs) {
        if (this.step(p.id)) progress = true;
      }
      if (!progress) {
        for (const p of this.procs) this.endRound(p.id);
        if (this.procs.every((p) => p.decided)) return;
      }
    }
  }

  decided(id: number): boolean { return this.proc(id).decided; }
  decision(id: number): string | null { return this.proc(id).decision; }
  extractedOf(id: number): string[] { return [...this.proc(id).extracted].sort(); }
  roundOf(id: number): number { return this.proc(id).round; }
  inboxSize(id: number): number { return this.proc(id).inbox.length; }
  sourceId(): number { return this.source; }
  faultBound(): number { return this.f; }
  processCount(): number { return this.n; }
}
