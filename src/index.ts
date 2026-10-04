export class AckWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends AckWinError {}
export class WindowFullError extends AckWinError {}
export class InvalidSeqError extends AckWinError {}
export class StaleEpochError extends AckWinError {}
export class ClosedError extends AckWinError {}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new AckWinError("cannot advance clock by a negative amount");
    }
    this.t += ms;
  }
}

export interface AckWinOptions {
  clock: VirtualClock;
  windowSize: number;
  rtoMs: number;
  maxRetx: number;
  recvBufSize: number;
}

interface InFlightEntry {
  seq: number;
  payload: string;
  sentAt: number;
  retx: number;
  rtoDeadline: number;
}

export type RecvResult = "delivered" | "buffered" | "duplicate" | "dropped";

export interface DriveResult {
  retransmitted: number[];
  failed: number[];
}

function isValidInt(v: number, min: number): boolean {
  return Number.isInteger(v) && v >= min;
}

export class AckWin {
  private readonly clock: VirtualClock;
  private readonly windowSize: number;
  private readonly rtoMs: number;
  private readonly maxRetx: number;
  private readonly recvBufSize: number;

  private epochN = 1;
  private closed = false;

  private nextSeq = 1;
  private maxSent = 0;
  private cumAckN = 0;
  private inFlightMap = new Map<number, InFlightEntry>();
  private payloadHistory = new Map<number, string>();

  private nextDeliverN = 1;
  private recvBuf = new Map<number, string>();
  private deliverQueue: Array<{ seq: number; payload: string }> = [];

  constructor(opts: AckWinOptions) {
    if (
      !opts ||
      !(opts.clock instanceof VirtualClock) ||
      !isValidInt(opts.windowSize, 1) ||
      !isValidInt(opts.rtoMs, 1) ||
      !isValidInt(opts.maxRetx, 0) ||
      !isValidInt(opts.recvBufSize, 1)
    ) {
      throw new InvalidConfigError("invalid AckWin configuration");
    }
    this.clock = opts.clock;
    this.windowSize = opts.windowSize;
    this.rtoMs = opts.rtoMs;
    this.maxRetx = opts.maxRetx;
    this.recvBufSize = opts.recvBufSize;
  }

  send(payload: string): { seq: number; epoch: number } {
    if (this.closed) throw new ClosedError("connection is closed");
    if (this.inFlightMap.size >= this.windowSize) {
      throw new WindowFullError("send window is full");
    }
    const seq = this.nextSeq++;
    this.maxSent = seq;
    const now = this.clock.now();
    this.inFlightMap.set(seq, {
      seq,
      payload,
      sentAt: now,
      retx: 0,
      rtoDeadline: now + this.rtoMs,
    });
    this.payloadHistory.set(seq, payload);
    return { seq, epoch: this.epochN };
  }

  ack(epoch: number, cumAck: number): boolean {
    if (epoch !== this.epochN) throw new StaleEpochError("stale epoch");
    if (!Number.isInteger(cumAck) || cumAck < 0 || cumAck > this.maxSent) {
      throw new InvalidSeqError("invalid cumulative ack");
    }
    if (cumAck <= this.cumAckN) return false;
    this.cumAckN = cumAck;
    for (const seq of [...this.inFlightMap.keys()]) {
      if (seq <= cumAck) this.inFlightMap.delete(seq);
    }
    return true;
  }

  recv(epoch: number, seq: number, payload: string): RecvResult {
    if (epoch !== this.epochN) throw new StaleEpochError("stale epoch");
    if (this.closed) throw new ClosedError("connection is closed");
    if (seq < this.nextDeliverN) return "duplicate";
    if (seq === this.nextDeliverN) {
      this.deliverQueue.push({ seq, payload });
      this.nextDeliverN++;
      while (this.recvBuf.has(this.nextDeliverN)) {
        const p = this.recvBuf.get(this.nextDeliverN)!;
        this.recvBuf.delete(this.nextDeliverN);
        this.deliverQueue.push({ seq: this.nextDeliverN, payload: p });
        this.nextDeliverN++;
      }
      return "delivered";
    }
    if (this.recvBuf.has(seq)) return "duplicate";
    if (this.recvBuf.size >= this.recvBufSize) return "dropped";
    this.recvBuf.set(seq, payload);
    return "buffered";
  }

  poll(): Array<{ seq: number; payload: string }> {
    const out = this.deliverQueue;
    this.deliverQueue = [];
    return out;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const retransmitted: number[] = [];
    const failed: number[] = [];
    const due = [...this.inFlightMap.values()]
      .filter((e) => now >= e.rtoDeadline)
      .sort((a, b) => a.seq - b.seq);
    for (const entry of due) {
      if (entry.retx < this.maxRetx) {
        entry.retx++;
        entry.rtoDeadline = now + this.rtoMs;
        retransmitted.push(entry.seq);
      } else {
        this.inFlightMap.delete(entry.seq);
        failed.push(entry.seq);
      }
    }
    return { retransmitted, failed };
  }

  payloadOf(seq: number): string | undefined {
    return this.payloadHistory.get(seq);
  }

  reset(): number {
    this.epochN++;
    this.inFlightMap.clear();
    this.nextSeq = 1;
    this.maxSent = 0;
    this.cumAckN = 0;
    this.recvBuf.clear();
    this.deliverQueue = [];
    this.nextDeliverN = 1;
    return this.epochN;
  }

  close(): void {
    this.closed = true;
  }

  epoch(): number {
    return this.epochN;
  }

  cumAck(): number {
    return this.cumAckN;
  }

  nextDeliver(): number {
    return this.nextDeliverN;
  }

  inFlight(): number {
    return this.inFlightMap.size;
  }

  buffered(): number {
    return this.recvBuf.size;
  }
}
