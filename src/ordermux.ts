import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidSeqError,
  StreamClosedError,
  StreamLimitError,
  UnknownStreamError,
} from "./errors.js";

export interface Delivery {
  streamId: string;
  seq: number;
  payload: string;
}

export interface OrderMuxOptions {
  clock: VirtualClock;
  bufSize: number;
  gapTimeoutMs: number;
  maxStreams?: number;
}

export type PushResult = "delivered" | "buffered" | "duplicate" | "dropped";

interface StreamState {
  gen: number;
  next: number;
  buffer: Map<number, string>;
  gapSince: number | null;
  closed: boolean;
}

const DEFAULT_MAX_STREAMS = 32;

export class OrderMux {
  private readonly clock: VirtualClock;
  private readonly bufSize: number;
  private readonly gapTimeoutMs: number;
  private readonly maxStreams: number;
  private readonly streams = new Map<string, StreamState>();
  private readonly queue: Delivery[] = [];

  constructor(options: OrderMuxOptions) {
    const { clock, bufSize, gapTimeoutMs } = options;
    const maxStreams = options.maxStreams ?? DEFAULT_MAX_STREAMS;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("clock with now() is required");
    }
    if (!Number.isInteger(bufSize) || bufSize < 1) {
      throw new InvalidConfigError("bufSize must be an integer >= 1");
    }
    if (!Number.isInteger(gapTimeoutMs) || gapTimeoutMs < 1) {
      throw new InvalidConfigError("gapTimeoutMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxStreams) || maxStreams < 1) {
      throw new InvalidConfigError("maxStreams must be an integer >= 1");
    }
    this.clock = clock;
    this.bufSize = bufSize;
    this.gapTimeoutMs = gapTimeoutMs;
    this.maxStreams = maxStreams;
  }

  open(streamId: string): { gen: number } {
    if (typeof streamId !== "string" || streamId.length === 0) {
      throw new InvalidSeqError("streamId must be a non-empty string");
    }
    const existing = this.streams.get(streamId);
    if (existing && !existing.closed) {
      throw new InvalidSeqError(`stream already open: ${streamId}`);
    }
    if (this.liveCount() >= this.maxStreams) {
      throw new StreamLimitError(`stream limit reached: ${this.maxStreams}`);
    }
    if (existing) {
      existing.gen += 1;
      existing.next = 1;
      existing.buffer.clear();
      existing.gapSince = null;
      existing.closed = false;
      return { gen: existing.gen };
    }
    this.streams.set(streamId, {
      gen: 1,
      next: 1,
      buffer: new Map(),
      gapSince: null,
      closed: false,
    });
    return { gen: 1 };
  }

  close(streamId: string, gen: number): boolean {
    const s = this.mustGet(streamId);
    if (gen !== s.gen) {
      throw new FenceError(`gen fence: expected ${s.gen}, got ${gen}`);
    }
    if (s.closed) {
      return false;
    }
    s.closed = true;
    s.buffer.clear();
    s.gapSince = null;
    return true;
  }

  reset(streamId: string, gen: number): number {
    const s = this.mustGet(streamId);
    if (gen !== s.gen) {
      throw new FenceError(`gen fence: expected ${s.gen}, got ${gen}`);
    }
    if (s.closed) {
      throw new StreamClosedError(`stream closed: ${streamId}`);
    }
    s.gen += 1;
    s.next = 1;
    s.buffer.clear();
    s.gapSince = null;
    return s.gen;
  }

  push(streamId: string, gen: number, seq: number, payload: string): PushResult {
    const s = this.mustGet(streamId);
    if (gen !== s.gen) {
      throw new FenceError(`gen fence: expected ${s.gen}, got ${gen}`);
    }
    if (s.closed) {
      throw new StreamClosedError(`stream closed: ${streamId}`);
    }
    if (!Number.isInteger(seq) || seq < 1) {
      throw new InvalidSeqError(`seq must be an integer >= 1, got ${seq}`);
    }
    if (seq < s.next) {
      return "duplicate";
    }
    if (seq === s.next) {
      this.enqueue(streamId, seq, payload);
      s.next += 1;
      this.drain(streamId, s);
      s.gapSince = s.buffer.size > 0 ? (s.gapSince ?? this.clock.now()) : null;
      return "delivered";
    }
    if (s.buffer.has(seq)) {
      return "duplicate";
    }
    if (s.buffer.size >= this.bufSize) {
      return "dropped";
    }
    s.buffer.set(seq, payload);
    if (s.gapSince === null) {
      s.gapSince = this.clock.now();
    }
    return "buffered";
  }

  drive(): { skipped: Array<{ streamId: string; seq: number }> } {
    const skipped: Array<{ streamId: string; seq: number }> = [];
    const now = this.clock.now();
    const ids = [...this.streams.keys()].sort();
    for (const id of ids) {
      const s = this.streams.get(id)!;
      if (s.closed || s.gapSince === null) {
        continue;
      }
      if (now < s.gapSince + this.gapTimeoutMs) {
        continue;
      }
      skipped.push({ streamId: id, seq: s.next });
      s.next += 1;
      this.drain(id, s);
      s.gapSince = s.buffer.size > 0 ? now : null;
    }
    return { skipped };
  }

  poll(maxn?: number): Delivery[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new InvalidSeqError(`maxn must be an integer >= 1, got ${maxn}`);
    }
    const n =
      maxn === undefined ? this.queue.length : Math.min(maxn, this.queue.length);
    return this.queue.splice(0, n);
  }

  nextOf(streamId: string): number {
    return this.mustGet(streamId).next;
  }

  bufferedOf(streamId: string): number {
    return this.mustGet(streamId).buffer.size;
  }

  genOf(streamId: string): number {
    return this.mustGet(streamId).gen;
  }

  openIds(): string[] {
    return [...this.streams.entries()]
      .filter(([, s]) => !s.closed)
      .map(([id]) => id)
      .sort();
  }

  private mustGet(streamId: string): StreamState {
    const s = this.streams.get(streamId);
    if (!s) {
      throw new UnknownStreamError(`unknown stream: ${streamId}`);
    }
    return s;
  }

  private liveCount(): number {
    let count = 0;
    for (const s of this.streams.values()) {
      if (!s.closed) {
        count += 1;
      }
    }
    return count;
  }

  private enqueue(streamId: string, seq: number, payload: string): void {
    this.queue.push({ streamId, seq, payload });
  }

  private drain(streamId: string, s: StreamState): void {
    while (s.buffer.has(s.next)) {
      const payload = s.buffer.get(s.next)!;
      s.buffer.delete(s.next);
      this.enqueue(streamId, s.next, payload);
      s.next += 1;
    }
  }
}
