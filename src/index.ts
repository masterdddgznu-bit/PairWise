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
      throw new WinAckError(`advance requires a non-negative number, got ${ms}`);
    }
    this.t += ms;
  }
}

export interface ClockLike {
  now(): number;
}

export interface WinAckOptions {
  clock: ClockLike;
  windowSize: number;
  rtoMs: number;
  maxRetransmit?: number;
}

type EntryStatus = "inflight" | "awaiting_resend" | "acked" | "dropped";

interface Entry {
  seq: number;
  payload: unknown;
  status: EntryStatus;
  sentAt: number;
  retransmits: number;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export class WinAck {
  private readonly clock: ClockLike;
  private readonly windowSize: number;
  private readonly rtoMs: number;
  private readonly maxRetransmit: number;

  private readonly entries = new Map<number, Entry>();
  private readonly resendQueue: number[] = [];
  private nextSeqValue = 1;
  private cumAckValue = 0;

  constructor(options: WinAckOptions) {
    const { clock, windowSize, rtoMs, maxRetransmit = 3 } = options;
    if (!isPositiveInt(windowSize)) {
      throw new InvalidConfigError(`windowSize must be an integer >= 1, got ${windowSize}`);
    }
    if (!isPositiveInt(rtoMs)) {
      throw new InvalidConfigError(`rtoMs must be an integer >= 1, got ${rtoMs}`);
    }
    if (!isNonNegativeInt(maxRetransmit)) {
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
        `window full: ${this.windowUsed()}/${this.windowSize} slots in use`,
      );
    }
    const seq = this.nextSeqValue;
    this.nextSeqValue += 1;
    this.entries.set(seq, {
      seq,
      payload,
      status: "inflight",
      sentAt: this.clock.now(),
      retransmits: 0,
    });
    return { seq };
  }

  ack(seq: number): { advanced: number } {
    if (!isNonNegativeInt(seq)) {
      throw new InvalidSeqError(`ack seq must be an integer >= 0, got ${seq}`);
    }
    if (seq <= this.cumAckValue) {
      return { advanced: 0 };
    }
    if (seq >= this.nextSeqValue) {
      throw new InvalidSeqError(
        `ack seq ${seq} beyond nextSeq ${this.nextSeqValue}`,
      );
    }
    for (let s = this.cumAckValue + 1; s <= seq; s += 1) {
      const entry = this.entries.get(s);
      if (entry && (entry.status === "inflight" || entry.status === "awaiting_resend")) {
        entry.status = "acked";
        this.removeFromResendQueue(s);
      }
    }
    const advanced = seq - this.cumAckValue;
    this.cumAckValue = seq;
    return { advanced };
  }

  nack(seq: number): boolean {
    if (!isNonNegativeInt(seq)) {
      throw new InvalidSeqError(`nack seq must be an integer >= 0, got ${seq}`);
    }
    const entry = this.entries.get(seq);
    if (!entry || entry.status === "acked" || entry.status === "dropped") {
      throw new UnknownSeqError(`nack of unknown seq ${seq}`);
    }
    if (entry.status === "awaiting_resend") {
      return false;
    }
    entry.status = "awaiting_resend";
    if (!this.resendQueue.includes(seq)) {
      this.resendQueue.push(seq);
    }
    return true;
  }

  drive(): { timedOut: number[]; dropped: number[] } {
    const now = this.clock.now();
    const timedOut: number[] = [];
    const dropped: number[] = [];
    const seqs = [...this.entries.keys()].sort((a, b) => a - b);
    for (const seq of seqs) {
      const entry = this.entries.get(seq);
      if (!entry || entry.status !== "inflight") continue;
      if (now < entry.sentAt + this.rtoMs) continue;
      if (entry.retransmits >= this.maxRetransmit) {
        entry.status = "dropped";
        dropped.push(seq);
      } else {
        entry.status = "awaiting_resend";
        if (!this.resendQueue.includes(seq)) {
          this.resendQueue.push(seq);
        }
        timedOut.push(seq);
      }
    }
    return { timedOut, dropped };
  }

  resend(): { seq: number; payload: unknown } | null {
    const seq = this.resendQueue.shift();
    if (seq === undefined) {
      return null;
    }
    const entry = this.entries.get(seq);
    if (!entry) {
      return null;
    }
    entry.status = "inflight";
    entry.sentAt = this.clock.now();
    entry.retransmits += 1;
    return { seq, payload: entry.payload };
  }

  cumAck(): number {
    return this.cumAckValue;
  }

  nextSeq(): number {
    return this.nextSeqValue;
  }

  inflightSeqs(): number[] {
    return [...this.entries.values()]
      .filter((e) => e.status === "inflight")
      .map((e) => e.seq)
      .sort((a, b) => a - b);
  }

  awaitingSeqs(): number[] {
    return [...this.resendQueue];
  }

  statusOf(seq: number): EntryStatus {
    const entry = this.entries.get(seq);
    if (!entry) {
      throw new UnknownSeqError(`unknown seq ${seq}`);
    }
    return entry.status;
  }

  inflightCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "inflight") count += 1;
    }
    return count;
  }

  windowUsed(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "inflight" || entry.status === "awaiting_resend") {
        count += 1;
      }
    }
    return count;
  }

  private removeFromResendQueue(seq: number): void {
    const idx = this.resendQueue.indexOf(seq);
    if (idx !== -1) {
      this.resendQueue.splice(idx, 1);
    }
  }
}
