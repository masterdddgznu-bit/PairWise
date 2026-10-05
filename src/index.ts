export class WinAckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends WinAckError {}
export class InvalidSeqError extends WinAckError {}
export class WindowFullError extends WinAckError {}
export class UnknownSeqError extends WinAckError {}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new WinAckError(`advance requires ms >= 0, got ${ms}`);
    }
    this.t += ms;
  }
}

export type WinAckStatus =
  | "inflight"
  | "awaiting_resend"
  | "acked"
  | "dropped";

interface Entry {
  status: WinAckStatus;
  payload: unknown;
  sentAt: number;
  retransmits: number;
}

export interface WinAckOptions {
  clock: VirtualClock;
  windowSize: number;
  rtoMs: number;
  maxRetransmit?: number;
}

function isNonNegativeInt(v: number): boolean {
  return Number.isInteger(v) && v >= 0;
}

export class WinAck {
  private readonly clock: VirtualClock;
  private readonly windowSize: number;
  private readonly rtoMs: number;
  private readonly maxRetransmit: number;

  private readonly entries = new Map<number, Entry>();
  private readonly resendQueue: number[] = [];
  private next = 1;
  private cum = 0;

  constructor(opts: WinAckOptions) {
    const { clock, windowSize, rtoMs, maxRetransmit = 3 } = opts;
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new InvalidConfigError(
        `windowSize must be an integer >= 1, got ${windowSize}`,
      );
    }
    if (!Number.isInteger(rtoMs) || rtoMs < 1) {
      throw new InvalidConfigError(
        `rtoMs must be an integer >= 1, got ${rtoMs}`,
      );
    }
    if (!Number.isInteger(maxRetransmit) || maxRetransmit < 0) {
      throw new InvalidConfigError(
        `maxRetransmit must be an integer >= 0, got ${maxRetransmit}`,
      );
    }
    this.clock = clock;
    this.windowSize = windowSize;
    this.rtoMs = rtoMs;
    this.maxRetransmit = maxRetransmit;
  }

  send(payload: unknown): { seq: number } {
    if (this.windowUsed() >= this.windowSize) {
      throw new WindowFullError(
        `window full: ${this.windowUsed()}/${this.windowSize} slots used`,
      );
    }
    const seq = this.next;
    this.next += 1;
    this.entries.set(seq, {
      status: "inflight",
      payload,
      sentAt: this.clock.now(),
      retransmits: 0,
    });
    return { seq };
  }

  ack(seq: number): { advanced: number } {
    if (!isNonNegativeInt(seq)) {
      throw new InvalidSeqError(`ack seq must be an integer >= 0, got ${seq}`);
    }
    if (seq <= this.cum) {
      return { advanced: 0 };
    }
    if (seq >= this.next) {
      throw new InvalidSeqError(
        `ack seq ${seq} beyond next seq ${this.next}`,
      );
    }
    const old = this.cum;
    for (let s = old + 1; s <= seq; s++) {
      const e = this.entries.get(s);
      if (e && (e.status === "inflight" || e.status === "awaiting_resend")) {
        e.status = "acked";
        this.removeFromQueue(s);
      }
    }
    this.cum = seq;
    return { advanced: seq - old };
  }

  nack(seq: number): boolean {
    if (!Number.isInteger(seq)) {
      throw new InvalidSeqError(`nack seq must be an integer, got ${seq}`);
    }
    const e = this.entries.get(seq);
    if (!e || e.status === "acked" || e.status === "dropped") {
      throw new UnknownSeqError(`unknown seq ${seq}`);
    }
    if (e.status === "awaiting_resend") {
      return false;
    }
    e.status = "awaiting_resend";
    if (!this.resendQueue.includes(seq)) {
      this.resendQueue.push(seq);
    }
    return true;
  }

  drive(): { timedOut: number[]; dropped: number[] } {
    const timedOut: number[] = [];
    const dropped: number[] = [];
    const now = this.clock.now();
    const seqs = [...this.entries.keys()].sort((a, b) => a - b);
    for (const s of seqs) {
      const e = this.entries.get(s)!;
      if (e.status !== "inflight") continue;
      if (now < e.sentAt + this.rtoMs) continue;
      if (e.retransmits >= this.maxRetransmit) {
        e.status = "dropped";
        dropped.push(s);
      } else {
        e.status = "awaiting_resend";
        if (!this.resendQueue.includes(s)) {
          this.resendQueue.push(s);
        }
        timedOut.push(s);
      }
    }
    return { timedOut, dropped };
  }

  resend(): { seq: number; payload: unknown } | null {
    const seq = this.resendQueue.shift();
    if (seq === undefined) {
      return null;
    }
    const e = this.entries.get(seq)!;
    e.status = "inflight";
    e.sentAt = this.clock.now();
    e.retransmits += 1;
    return { seq, payload: e.payload };
  }

  cumAck(): number {
    return this.cum;
  }

  nextSeq(): number {
    return this.next;
  }

  inflightSeqs(): number[] {
    const out: number[] = [];
    for (const [s, e] of this.entries) {
      if (e.status === "inflight") out.push(s);
    }
    return out.sort((a, b) => a - b);
  }

  awaitingSeqs(): number[] {
    return [...this.resendQueue];
  }

  statusOf(seq: number): WinAckStatus {
    if (!Number.isInteger(seq)) {
      throw new InvalidSeqError(`seq must be an integer, got ${seq}`);
    }
    const e = this.entries.get(seq);
    if (!e) {
      throw new UnknownSeqError(`unknown seq ${seq}`);
    }
    return e.status;
  }

  inflightCount(): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.status === "inflight") n++;
    }
    return n;
  }

  windowUsed(): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.status === "inflight" || e.status === "awaiting_resend") n++;
    }
    return n;
  }

  private removeFromQueue(seq: number): void {
    const i = this.resendQueue.indexOf(seq);
    if (i >= 0) {
      this.resendQueue.splice(i, 1);
    }
  }
}
