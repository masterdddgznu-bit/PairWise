import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidRequestError,
  StreamClosedError,
  StreamLimitError,
  UnknownStreamError,
} from "./errors.js";

export interface CredMuxOptions {
  clock: VirtualClock;
  initialCredit: number;
  maxCredit: number;
  idleTimeoutMs: number;
  maxStreams?: number;
  maxPending?: number;
}

export type SendResult =
  | { status: "sent"; seq: number; credit: number }
  | { status: "pending"; pending: number };

export interface Delivery {
  seq: number;
  payload: string;
}

interface StreamState {
  id: string;
  gen: number;
  credit: number;
  closed: boolean;
  queue: Delivery[];
  pending: string[];
  nextSeq: number;
  lastActiveAt: number;
}

function isNonNegativeInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export class CredMux {
  private readonly clock: VirtualClock;
  private readonly initialCredit: number;
  private readonly maxCredit: number;
  private readonly idleTimeoutMs: number;
  private readonly maxStreams: number;
  private readonly maxPending: number;
  private readonly streams = new Map<string, StreamState>();

  constructor(options: CredMuxOptions) {
    const {
      clock,
      initialCredit,
      maxCredit,
      idleTimeoutMs,
      maxStreams = 64,
      maxPending = 16,
    } = options;
    if (
      !(clock instanceof VirtualClock) ||
      !isNonNegativeInteger(initialCredit) ||
      !isNonNegativeInteger(maxCredit) ||
      maxCredit < initialCredit ||
      !Number.isInteger(idleTimeoutMs) ||
      idleTimeoutMs < 1 ||
      !Number.isInteger(maxStreams) ||
      maxStreams < 1 ||
      !Number.isInteger(maxPending) ||
      maxPending < 1
    ) {
      throw new InvalidConfigError("invalid CredMux configuration");
    }
    this.clock = clock;
    this.initialCredit = initialCredit;
    this.maxCredit = maxCredit;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxStreams = maxStreams;
    this.maxPending = maxPending;
  }

  open(streamId: string): { gen: number; credit: number } {
    this.assertValidId(streamId);
    const existing = this.streams.get(streamId);
    if (existing && !existing.closed) {
      throw new InvalidRequestError(`stream already open: ${streamId}`);
    }
    if (!existing && this.openCount() >= this.maxStreams) {
      throw new StreamLimitError("max open streams reached");
    }
    const gen = existing ? existing.gen + 1 : 1;
    this.streams.set(streamId, {
      id: streamId,
      gen,
      credit: this.initialCredit,
      closed: false,
      queue: [],
      pending: [],
      nextSeq: 1,
      lastActiveAt: this.clock.now(),
    });
    return { gen, credit: this.initialCredit };
  }

  close(streamId: string, gen: number): boolean {
    const stream = this.getChecked(streamId, gen);
    if (stream.closed) {
      return false;
    }
    stream.closed = true;
    stream.pending = [];
    stream.queue = [];
    stream.credit = 0;
    return true;
  }

  reset(streamId: string, gen: number): number {
    const stream = this.getLiveChecked(streamId, gen);
    stream.gen += 1;
    stream.credit = this.initialCredit;
    stream.pending = [];
    stream.queue = [];
    stream.nextSeq = 1;
    stream.lastActiveAt = this.clock.now();
    return stream.gen;
  }

  send(streamId: string, gen: number, payload: string): SendResult {
    const stream = this.getLiveChecked(streamId, gen);
    if (typeof payload !== "string") {
      throw new InvalidRequestError("payload must be a string");
    }
    stream.lastActiveAt = this.clock.now();
    if (stream.credit >= 1) {
      stream.credit -= 1;
      const seq = stream.nextSeq++;
      stream.queue.push({ seq, payload });
      return { status: "sent", seq, credit: stream.credit };
    }
    if (stream.pending.length >= this.maxPending) {
      throw new InvalidRequestError("pending queue full");
    }
    stream.pending.push(payload);
    return { status: "pending", pending: stream.pending.length };
  }

  grant(streamId: string, gen: number, n: number): number {
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidRequestError("grant amount must be an integer >= 1");
    }
    const stream = this.getLiveChecked(streamId, gen);
    stream.credit = Math.min(this.maxCredit, stream.credit + n);
    while (stream.credit >= 1 && stream.pending.length > 0) {
      const payload = stream.pending.shift() as string;
      stream.credit -= 1;
      const seq = stream.nextSeq++;
      stream.queue.push({ seq, payload });
    }
    stream.lastActiveAt = this.clock.now();
    return stream.credit;
  }

  poll(streamId: string, gen: number, maxn?: number): Delivery[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new InvalidRequestError("maxn must be an integer >= 1");
    }
    const stream = this.getLiveChecked(streamId, gen);
    const count = maxn === undefined ? stream.queue.length : Math.min(maxn, stream.queue.length);
    const out = stream.queue.splice(0, count);
    stream.lastActiveAt = this.clock.now();
    return out;
  }

  creditOf(streamId: string): number {
    return this.getKnown(streamId).credit;
  }

  genOf(streamId: string): number {
    return this.getKnown(streamId).gen;
  }

  pendingOf(streamId: string): number {
    return this.getKnown(streamId).pending.length;
  }

  queuedOf(streamId: string): number {
    return this.getKnown(streamId).queue.length;
  }

  openIds(): string[] {
    const ids: string[] = [];
    for (const stream of this.streams.values()) {
      if (!stream.closed) {
        ids.push(stream.id);
      }
    }
    return ids.sort();
  }

  drive(): { idleClosed: string[] } {
    const now = this.clock.now();
    const idleClosed: string[] = [];
    for (const stream of this.streams.values()) {
      if (!stream.closed && now >= stream.lastActiveAt + this.idleTimeoutMs) {
        stream.closed = true;
        stream.pending = [];
        stream.queue = [];
        stream.credit = 0;
        idleClosed.push(stream.id);
      }
    }
    return { idleClosed: idleClosed.sort() };
  }

  private openCount(): number {
    let count = 0;
    for (const stream of this.streams.values()) {
      if (!stream.closed) {
        count += 1;
      }
    }
    return count;
  }

  private assertValidId(streamId: string): void {
    if (typeof streamId !== "string" || streamId.length === 0) {
      throw new InvalidRequestError("streamId must be a non-empty string");
    }
  }

  private getKnown(streamId: string): StreamState {
    const stream = this.streams.get(streamId);
    if (!stream) {
      throw new UnknownStreamError(`unknown stream: ${streamId}`);
    }
    return stream;
  }

  private getChecked(streamId: string, gen: number): StreamState {
    const stream = this.getKnown(streamId);
    if (stream.gen !== gen) {
      throw new FenceError(`gen mismatch for stream: ${streamId}`);
    }
    return stream;
  }

  private getLiveChecked(streamId: string, gen: number): StreamState {
    const stream = this.getChecked(streamId, gen);
    if (stream.closed) {
      throw new StreamClosedError(`stream closed: ${streamId}`);
    }
    return stream;
  }
}
