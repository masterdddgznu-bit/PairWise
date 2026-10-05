import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidPushError,
  UnknownStreamError,
} from "./errors.js";

export interface HoleBufOptions {
  clock: VirtualClock;
  maxBuffered?: number;
  skipAfterMs?: number;
}

export type PushStatus = "delivered" | "buffered" | "rejected";

interface TakeEntry {
  seq: number;
  payload: unknown;
}

interface StreamState {
  nextSeq: number;
  buffer: Map<number, unknown>;
  queue: TakeEntry[];
  deliveredCount: number;
  holeSeq: number | null;
  holeSince: number | null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class HoleBuf {
  private readonly clock: VirtualClock;
  private readonly maxBuffered: number;
  private readonly skipAfterMs: number;
  private readonly streams = new Map<string, StreamState>();

  constructor(options: HoleBufOptions) {
    const maxBuffered = options.maxBuffered ?? 16;
    const skipAfterMs = options.skipAfterMs ?? 10;
    if (!isPositiveInteger(maxBuffered)) {
      throw new InvalidConfigError("maxBuffered must be an integer >= 1");
    }
    if (!isPositiveInteger(skipAfterMs)) {
      throw new InvalidConfigError("skipAfterMs must be an integer >= 1");
    }
    this.clock = options.clock;
    this.maxBuffered = maxBuffered;
    this.skipAfterMs = skipAfterMs;
  }

  push(
    stream: string,
    seq: number,
    payload: unknown,
  ): { status: PushStatus } {
    if (typeof stream !== "string" || stream.length === 0) {
      throw new InvalidPushError("stream must be a non-empty string");
    }
    if (typeof seq !== "number" || !Number.isFinite(seq) || !Number.isInteger(seq) || seq < 1) {
      throw new InvalidPushError("seq must be a finite integer >= 1");
    }
    const state = this.getOrCreate(stream);
    if (seq < state.nextSeq || state.buffer.has(seq)) {
      return { status: "rejected" };
    }
    if (seq === state.nextSeq) {
      state.queue.push({ seq, payload });
      state.deliveredCount += 1;
      state.nextSeq += 1;
      this.cascade(state);
      this.refreshHole(state);
      return { status: "delivered" };
    }
    if (state.buffer.size >= this.maxBuffered) {
      return { status: "rejected" };
    }
    state.buffer.set(seq, payload);
    this.refreshHole(state);
    return { status: "buffered" };
  }

  take(stream: string): { seq: number; payload: unknown } | null {
    const state = this.streams.get(stream);
    if (!state || state.queue.length === 0) {
      return null;
    }
    return state.queue.shift() ?? null;
  }

  skip(stream: string): { skipped: number | null; nextSeq: number } {
    const state = this.requireStream(stream);
    if (!this.hasHole(state)) {
      return { skipped: null, nextSeq: state.nextSeq };
    }
    const skipped = this.skipOne(state);
    return { skipped, nextSeq: state.nextSeq };
  }

  drop(stream: string, seq: number): boolean {
    const state = this.requireStream(stream);
    const removed = state.buffer.delete(seq);
    if (removed) {
      this.refreshHole(state);
    }
    return removed;
  }

  reset(stream: string): void {
    const state = this.requireStream(stream);
    state.nextSeq = 1;
    state.buffer.clear();
    state.queue.length = 0;
    state.holeSeq = null;
    state.holeSince = null;
  }

  drive(): { skipped: Array<{ stream: string; seq: number }> } {
    const skipped: Array<{ stream: string; seq: number }> = [];
    const now = this.clock.now();
    for (const [stream, state] of this.streams) {
      if (
        this.hasHole(state) &&
        state.holeSince !== null &&
        now - state.holeSince >= this.skipAfterMs
      ) {
        const seq = this.skipOne(state);
        skipped.push({ stream, seq });
      }
    }
    skipped.sort((a, b) =>
      a.stream === b.stream ? a.seq - b.seq : a.stream < b.stream ? -1 : 1,
    );
    return { skipped };
  }

  nextSeq(stream: string): number {
    return this.streams.get(stream)?.nextSeq ?? 1;
  }

  bufferedSeqs(stream: string): number[] {
    const state = this.streams.get(stream);
    if (!state) {
      return [];
    }
    return [...state.buffer.keys()].sort((a, b) => a - b);
  }

  pendingTake(stream: string): number {
    return this.streams.get(stream)?.queue.length ?? 0;
  }

  deliveredCount(stream: string): number {
    return this.streams.get(stream)?.deliveredCount ?? 0;
  }

  private getOrCreate(stream: string): StreamState {
    let state = this.streams.get(stream);
    if (!state) {
      state = {
        nextSeq: 1,
        buffer: new Map(),
        queue: [],
        deliveredCount: 0,
        holeSeq: null,
        holeSince: null,
      };
      this.streams.set(stream, state);
    }
    return state;
  }

  private requireStream(stream: string): StreamState {
    const state = this.streams.get(stream);
    if (!state) {
      throw new UnknownStreamError(`unknown stream: ${stream}`);
    }
    return state;
  }

  private hasHole(state: StreamState): boolean {
    return state.buffer.size > 0 && !state.buffer.has(state.nextSeq);
  }

  private cascade(state: StreamState): void {
    while (state.buffer.has(state.nextSeq)) {
      const payload = state.buffer.get(state.nextSeq);
      state.buffer.delete(state.nextSeq);
      state.queue.push({ seq: state.nextSeq, payload });
      state.deliveredCount += 1;
      state.nextSeq += 1;
    }
  }

  private skipOne(state: StreamState): number {
    const skipped = state.nextSeq;
    state.nextSeq += 1;
    this.cascade(state);
    this.refreshHole(state);
    return skipped;
  }

  private refreshHole(state: StreamState): void {
    if (!this.hasHole(state)) {
      state.holeSeq = null;
      state.holeSince = null;
      return;
    }
    if (state.holeSeq !== state.nextSeq) {
      state.holeSeq = state.nextSeq;
      state.holeSince = this.clock.now();
    }
  }
}
