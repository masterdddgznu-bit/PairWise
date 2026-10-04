import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidSeqError,
  OrderMuxError,
  StreamClosedError,
  StreamLimitError,
  UnknownStreamError,
} from "./errors.js";

export interface OrderMuxOptions {
  clock: VirtualClock;
  bufSize: number;
  gapTimeoutMs: number;
  maxStreams?: number;
}

export interface Delivery {
  streamId: string;
  seq: number;
  payload: string;
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
    if (!(clock instanceof VirtualClock)) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    if (!Number.isInteger(bufSize) || bufSize < 1) {
      throw new InvalidConfigError("bufSize must be an integer >= 1");
    }
    if (
      typeof gapTimeoutMs !== "number" ||
      !Number.isFinite(gapTimeoutMs) ||
      gapTimeoutMs < 1
    ) {
      throw new InvalidConfigError("gapTimeoutMs must be a number >= 1");
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
      throw new InvalidSeqError(`stream "${streamId}" is already open`);
    }
    if (this.openCount() >= this.maxStreams) {
      throw new StreamLimitError(
        `cannot open more than ${this.maxStreams} streams`,
      );
    }
    if (existing) {
      existing.gen += 1;
      existing.next = 1;
      existing.buffer.clear();
      existing.gapSince = null;
      existing.closed = false;
      return { gen: existing.gen };
    }
    const state: StreamState = {
      gen: 1,
      next: 1,
      buffer: new Map(),
      gapSince: null,
      closed: false,
    };
    this.streams.set(streamId, state);
    return { gen: state.gen };
  }

  close(streamId: string, gen: number): boolean {
    const state = this.getStream(streamId);
    this.checkGen(state, gen);
    if (state.closed) {
      return false;
    }
    state.closed = true;
    state.buffer.clear();
    state.gapSince = null;
    return true;
  }

  reset(streamId: string, gen: number): number {
    const state = this.getStream(streamId);
    this.checkGen(state, gen);
    this.checkOpen(state, streamId);
    state.gen += 1;
    state.next = 1;
    state.buffer.clear();
    state.gapSince = null;
    return state.gen;
  }

  push(streamId: string, gen: number, seq: number, payload: string): PushResult {
    const state = this.getStream(streamId);
    this.checkGen(state, gen);
    this.checkOpen(state, streamId);
    if (!Number.isInteger(seq) || seq < 1) {
      throw new InvalidSeqError("seq must be an integer >= 1");
    }
    if (seq < state.next) {
      return "duplicate";
    }
    if (seq === state.next) {
      this.deliver(state, streamId, seq, payload);
      return "delivered";
    }
    if (state.buffer.has(seq)) {
      return "duplicate";
    }
    if (state.buffer.size >= this.bufSize) {
      return "dropped";
    }
    state.buffer.set(seq, payload);
    if (state.gapSince === null) {
      state.gapSince = this.clock.now();
    }
    return "buffered";
  }

  drive(): { skipped: Array<{ streamId: string; seq: number }> } {
    const skipped: Array<{ streamId: string; seq: number }> = [];
    const now = this.clock.now();
    const ids = [...this.streams.keys()].sort();
    for (const streamId of ids) {
      const state = this.streams.get(streamId)!;
      if (state.closed || state.gapSince === null) {
        continue;
      }
      if (now < state.gapSince + this.gapTimeoutMs) {
        continue;
      }
      skipped.push({ streamId, seq: state.next });
      state.next += 1;
      this.drainBuffer(state, streamId);
      state.gapSince = state.buffer.size > 0 ? now : null;
    }
    skipped.sort((a, b) =>
      a.streamId === b.streamId ? a.seq - b.seq : a.streamId < b.streamId ? -1 : 1,
    );
    return { skipped };
  }

  poll(maxn?: number): Delivery[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new OrderMuxError("maxn must be an integer >= 1");
    }
    const count = maxn === undefined ? this.queue.length : Math.min(maxn, this.queue.length);
    return this.queue.splice(0, count);
  }

  nextOf(streamId: string): number {
    return this.getStream(streamId).next;
  }

  bufferedOf(streamId: string): number {
    return this.getStream(streamId).buffer.size;
  }

  genOf(streamId: string): number {
    return this.getStream(streamId).gen;
  }

  openIds(): string[] {
    return [...this.streams.entries()]
      .filter(([, state]) => !state.closed)
      .map(([id]) => id)
      .sort();
  }

  private deliver(state: StreamState, streamId: string, seq: number, payload: string): void {
    this.queue.push({ streamId, seq, payload });
    state.next += 1;
    this.drainBuffer(state, streamId);
    if (state.buffer.size === 0) {
      state.gapSince = null;
    } else if (state.gapSince === null) {
      state.gapSince = this.clock.now();
    }
  }

  private drainBuffer(state: StreamState, streamId: string): void {
    while (state.buffer.has(state.next)) {
      const payload = state.buffer.get(state.next)!;
      state.buffer.delete(state.next);
      this.queue.push({ streamId, seq: state.next, payload });
      state.next += 1;
    }
  }

  private getStream(streamId: string): StreamState {
    const state = this.streams.get(streamId);
    if (!state) {
      throw new UnknownStreamError(`unknown stream "${streamId}"`);
    }
    return state;
  }

  private checkGen(state: StreamState, gen: number): void {
    if (gen !== state.gen) {
      throw new FenceError(`gen mismatch: expected ${state.gen}, got ${gen}`);
    }
  }

  private checkOpen(state: StreamState, streamId: string): void {
    if (state.closed) {
      throw new StreamClosedError(`stream "${streamId}" is closed`);
    }
  }

  private openCount(): number {
    let count = 0;
    for (const state of this.streams.values()) {
      if (!state.closed) {
        count += 1;
      }
    }
    return count;
  }
}
