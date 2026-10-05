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

export interface PushResult {
  status: "delivered" | "buffered" | "rejected";
}

export interface TakeEntry {
  seq: number;
  payload: unknown;
}

export interface SkipResult {
  skipped: number | null;
  nextSeq: number;
}

export interface DriveResult {
  skipped: Array<{ stream: string; seq: number }>;
}

interface StreamState {
  nextSeq: number;
  buffer: Map<number, unknown>;
  takeQueue: TakeEntry[];
  deliveredCount: number;
  holeSince: number | null;
}

function freshState(): StreamState {
  return {
    nextSeq: 1,
    buffer: new Map(),
    takeQueue: [],
    deliveredCount: 0,
    holeSince: null,
  };
}

export class HoleBuf {
  #clock: VirtualClock;
  #maxBuffered: number;
  #skipAfterMs: number;
  #streams = new Map<string, StreamState>();

  constructor(options: HoleBufOptions) {
    const { clock, maxBuffered = 16, skipAfterMs = 10 } = options ?? {};
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (!Number.isInteger(maxBuffered) || maxBuffered < 1) {
      throw new InvalidConfigError("maxBuffered must be an integer >= 1");
    }
    if (!Number.isInteger(skipAfterMs) || skipAfterMs < 1) {
      throw new InvalidConfigError("skipAfterMs must be an integer >= 1");
    }
    this.#clock = clock;
    this.#maxBuffered = maxBuffered;
    this.#skipAfterMs = skipAfterMs;
  }

  push(stream: string, seq: number, payload: unknown): PushResult {
    if (typeof stream !== "string" || stream.length === 0) {
      throw new InvalidPushError("stream must be a non-empty string");
    }
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      throw new InvalidPushError("seq must be a finite integer >= 1");
    }
    let state = this.#streams.get(stream);
    if (!state) {
      state = freshState();
      this.#streams.set(stream, state);
    }
    if (seq < state.nextSeq || state.buffer.has(seq)) {
      return { status: "rejected" };
    }
    if (seq === state.nextSeq) {
      state.takeQueue.push({ seq, payload });
      state.deliveredCount += 1;
      state.nextSeq += 1;
      this.#cascade(state);
      this.#refreshHole(state);
      return { status: "delivered" };
    }
    if (state.buffer.size >= this.#maxBuffered) {
      return { status: "rejected" };
    }
    state.buffer.set(seq, payload);
    this.#refreshHole(state);
    return { status: "buffered" };
  }

  take(stream: string): TakeEntry | null {
    const state = this.#streams.get(stream);
    if (!state || state.takeQueue.length === 0) {
      return null;
    }
    return state.takeQueue.shift() ?? null;
  }

  skip(stream: string): SkipResult {
    const state = this.#streams.get(stream);
    if (!state) {
      throw new UnknownStreamError(`unknown stream: ${stream}`);
    }
    if (!this.#hasHole(state)) {
      return { skipped: null, nextSeq: state.nextSeq };
    }
    const skipped = this.#skipOne(state);
    return { skipped, nextSeq: state.nextSeq };
  }

  drop(stream: string, seq: number): boolean {
    const state = this.#streams.get(stream);
    if (!state) {
      throw new UnknownStreamError(`unknown stream: ${stream}`);
    }
    const removed = state.buffer.delete(seq);
    if (removed) {
      this.#refreshHole(state);
    }
    return removed;
  }

  reset(stream: string): void {
    const state = this.#streams.get(stream);
    if (!state) {
      throw new UnknownStreamError(`unknown stream: ${stream}`);
    }
    state.nextSeq = 1;
    state.buffer.clear();
    state.takeQueue = [];
    state.holeSince = null;
  }

  drive(): DriveResult {
    const skipped: Array<{ stream: string; seq: number }> = [];
    const now = this.#clock.now();
    for (const [stream, state] of this.#streams) {
      if (!this.#hasHole(state) || state.holeSince === null) {
        continue;
      }
      if (now - state.holeSince >= this.#skipAfterMs) {
        skipped.push({ stream, seq: this.#skipOne(state) });
      }
    }
    skipped.sort((a, b) =>
      a.stream === b.stream ? a.seq - b.seq : a.stream < b.stream ? -1 : 1,
    );
    return { skipped };
  }

  nextSeq(stream: string): number {
    return this.#streams.get(stream)?.nextSeq ?? 1;
  }

  bufferedSeqs(stream: string): number[] {
    const state = this.#streams.get(stream);
    if (!state) {
      return [];
    }
    return [...state.buffer.keys()].sort((a, b) => a - b);
  }

  pendingTake(stream: string): number {
    return this.#streams.get(stream)?.takeQueue.length ?? 0;
  }

  deliveredCount(stream: string): number {
    return this.#streams.get(stream)?.deliveredCount ?? 0;
  }

  #hasHole(state: StreamState): boolean {
    return state.buffer.size > 0 && !state.buffer.has(state.nextSeq);
  }

  #refreshHole(state: StreamState): void {
    if (!this.#hasHole(state)) {
      state.holeSince = null;
    } else if (state.holeSince === null) {
      state.holeSince = this.#clock.now();
    }
  }

  #cascade(state: StreamState): void {
    while (state.buffer.has(state.nextSeq)) {
      const payload = state.buffer.get(state.nextSeq);
      state.buffer.delete(state.nextSeq);
      state.takeQueue.push({ seq: state.nextSeq, payload });
      state.deliveredCount += 1;
      state.nextSeq += 1;
    }
  }

  #skipOne(state: StreamState): number {
    const skipped = state.nextSeq;
    state.nextSeq += 1;
    this.#cascade(state);
    state.holeSince = this.#hasHole(state) ? this.#clock.now() : null;
    return skipped;
  }
}
