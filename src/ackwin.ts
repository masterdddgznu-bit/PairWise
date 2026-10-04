import { VirtualClock } from "./clock.js";
import {
  ClosedError,
  InvalidConfigError,
  InvalidSeqError,
  StaleEpochError,
  WindowFullError,
} from "./errors.js";

export interface AckWinOptions {
  clock: VirtualClock;
  windowSize: number;
  rtoMs: number;
  maxRetx: number;
  recvBufSize: number;
}

interface InFlightEntry {
  payload: string;
  sentAt: number;
  retx: number;
  rtoDeadline: number;
}

export type RecvResult = "delivered" | "buffered" | "duplicate" | "dropped";

export class AckWin {
  private readonly clock: VirtualClock;
  private readonly windowSize: number;
  private readonly rtoMs: number;
  private readonly maxRetx: number;
  private readonly recvBufSize: number;

  private epochVal = 1;
  private closed = false;

  private nextSendSeq = 1;
  private maxSent = 0;
  private cumAckVal = 0;
  private readonly inFlightMap = new Map<number, InFlightEntry>();
  private readonly payloadHistory = new Map<number, string>();

  private nextDeliverVal = 1;
  private readonly recvBuffer = new Map<number, string>();
  private deliveryQueue: Array<{ seq: number; payload: string }> = [];

  constructor(options: AckWinOptions) {
    const { clock, windowSize, rtoMs, maxRetx, recvBufSize } = options;
    if (
      !clock ||
      !Number.isInteger(windowSize) ||
      windowSize < 1 ||
      !Number.isInteger(rtoMs) ||
      rtoMs < 1 ||
      !Number.isInteger(maxRetx) ||
      maxRetx < 0 ||
      !Number.isInteger(recvBufSize) ||
      recvBufSize < 1
    ) {
      throw new InvalidConfigError("invalid AckWin configuration");
    }
    this.clock = clock;
    this.windowSize = windowSize;
    this.rtoMs = rtoMs;
    this.maxRetx = maxRetx;
    this.recvBufSize = recvBufSize;
  }

  send(payload: string): { seq: number; epoch: number } {
    if (this.closed) {
      throw new ClosedError("connection is closed");
    }
    if (this.inFlightMap.size >= this.windowSize) {
      throw new WindowFullError("send window is full");
    }
    const seq = this.nextSendSeq++;
    const now = this.clock.now();
    this.inFlightMap.set(seq, {
      payload,
      sentAt: now,
      retx: 0,
      rtoDeadline: now + this.rtoMs,
    });
    this.payloadHistory.set(seq, payload);
    this.maxSent = seq;
    return { seq, epoch: this.epochVal };
  }

  ack(epoch: number, cumAck: number): boolean {
    if (epoch !== this.epochVal) {
      throw new StaleEpochError("stale epoch");
    }
    if (!Number.isInteger(cumAck) || cumAck < 0 || cumAck > this.maxSent) {
      throw new InvalidSeqError("invalid cumulative ack");
    }
    if (cumAck <= this.cumAckVal) {
      return false;
    }
    this.cumAckVal = cumAck;
    for (const seq of [...this.inFlightMap.keys()]) {
      if (seq <= cumAck) {
        this.inFlightMap.delete(seq);
      }
    }
    return true;
  }

  recv(epoch: number, seq: number, payload: string): RecvResult {
    if (this.closed) {
      throw new ClosedError("connection is closed");
    }
    if (epoch !== this.epochVal) {
      throw new StaleEpochError("stale epoch");
    }
    if (seq < this.nextDeliverVal) {
      return "duplicate";
    }
    if (seq === this.nextDeliverVal) {
      this.deliver(seq, payload);
      this.nextDeliverVal++;
      while (this.recvBuffer.has(this.nextDeliverVal)) {
        const bufferedPayload = this.recvBuffer.get(this.nextDeliverVal)!;
        this.recvBuffer.delete(this.nextDeliverVal);
        this.deliver(this.nextDeliverVal, bufferedPayload);
        this.nextDeliverVal++;
      }
      return "delivered";
    }
    if (this.recvBuffer.has(seq)) {
      return "duplicate";
    }
    if (this.recvBuffer.size >= this.recvBufSize) {
      return "dropped";
    }
    this.recvBuffer.set(seq, payload);
    return "buffered";
  }

  poll(): Array<{ seq: number; payload: string }> {
    const out = this.deliveryQueue;
    this.deliveryQueue = [];
    return out;
  }

  drive(): { retransmitted: number[]; failed: number[] } {
    const now = this.clock.now();
    const retransmitted: number[] = [];
    const failed: number[] = [];
    const due = [...this.inFlightMap.entries()]
      .filter(([, entry]) => now >= entry.rtoDeadline)
      .sort((a, b) => a[0] - b[0]);
    for (const [seq, entry] of due) {
      if (entry.retx < this.maxRetx) {
        entry.retx++;
        entry.rtoDeadline = now + this.rtoMs;
        retransmitted.push(seq);
      } else {
        this.inFlightMap.delete(seq);
        failed.push(seq);
      }
    }
    return { retransmitted, failed };
  }

  payloadOf(seq: number): string | undefined {
    return this.payloadHistory.get(seq);
  }

  reset(): number {
    this.epochVal++;
    this.inFlightMap.clear();
    this.nextSendSeq = 1;
    this.maxSent = 0;
    this.cumAckVal = 0;
    this.recvBuffer.clear();
    this.deliveryQueue = [];
    this.nextDeliverVal = 1;
    return this.epochVal;
  }

  close(): void {
    this.closed = true;
  }

  epoch(): number {
    return this.epochVal;
  }

  cumAck(): number {
    return this.cumAckVal;
  }

  nextDeliver(): number {
    return this.nextDeliverVal;
  }

  inFlight(): number {
    return this.inFlightMap.size;
  }

  buffered(): number {
    return this.recvBuffer.size;
  }

  private deliver(seq: number, payload: string): void {
    this.deliveryQueue.push({ seq, payload });
  }
}
