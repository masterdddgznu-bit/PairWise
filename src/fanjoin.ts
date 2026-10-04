import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidSeqError,
  UnknownProducerError,
} from "./errors.js";

export type Slot =
  | { kind: "value"; payload: string }
  | { kind: "skipped" };

export type JoinEvent = {
  seq: number;
  values: Record<string, string>;
  missing: string[];
};

export type PushResult = "accepted" | "duplicate" | "dropped";

export type FanJoinConfig = {
  clock: VirtualClock;
  producers: string[];
  bufSize: number;
  gapTimeoutMs: number;
};

type ProducerState = {
  name: string;
  next: number;
  buffer: Map<number, string>;
  gapSince: number | null;
  slots: Map<number, Slot>;
};

export class FanJoin {
  private readonly clock: VirtualClock;
  private readonly bufSize: number;
  private readonly gapTimeoutMs: number;
  private readonly states: ProducerState[];
  private readonly byName: Map<string, ProducerState>;
  private joinSeq = 1;
  private readonly joined: JoinEvent[] = [];

  constructor(config: FanJoinConfig) {
    const { clock, producers, bufSize, gapTimeoutMs } = config;
    if (
      !clock ||
      typeof clock.now !== "function" ||
      typeof clock.advance !== "function"
    ) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    if (
      !Array.isArray(producers) ||
      producers.length === 0 ||
      producers.some((p) => typeof p !== "string" || p.length === 0)
    ) {
      throw new InvalidConfigError("producers must be a non-empty string array");
    }
    if (new Set(producers).size !== producers.length) {
      throw new InvalidConfigError("producers must be unique");
    }
    if (!Number.isInteger(bufSize) || bufSize < 1) {
      throw new InvalidConfigError("bufSize must be an integer >= 1");
    }
    if (
      typeof gapTimeoutMs !== "number" ||
      Number.isNaN(gapTimeoutMs) ||
      gapTimeoutMs < 1
    ) {
      throw new InvalidConfigError("gapTimeoutMs must be a number >= 1");
    }

    this.clock = clock;
    this.bufSize = bufSize;
    this.gapTimeoutMs = gapTimeoutMs;
    const sorted = [...producers].sort();
    this.states = sorted.map((name) => ({
      name,
      next: 1,
      buffer: new Map(),
      gapSince: null,
      slots: new Map(),
    }));
    this.byName = new Map(this.states.map((s) => [s.name, s]));
  }

  producers(): string[] {
    return this.states.map((s) => s.name);
  }

  nextOf(producer: string): number {
    return this.stateOf(producer).next;
  }

  bufferedOf(producer: string): number {
    return this.stateOf(producer).buffer.size;
  }

  joinNext(): number {
    return this.joinSeq;
  }

  push(producer: string, seq: number, payload: string): PushResult {
    const state = this.stateOf(producer);
    if (!Number.isInteger(seq) || seq < 1) {
      throw new InvalidSeqError(`invalid seq: ${seq}`);
    }
    if (seq < state.next) {
      return "duplicate";
    }
    if (seq === state.next) {
      this.settle(state, seq, { kind: "value", payload });
      this.drainBuffer(state);
      this.refreshGap(state);
      this.advanceJoin();
      return "accepted";
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
    return "accepted";
  }

  drive(): { skipped: Array<{ producer: string; seq: number }> } {
    const skipped: Array<{ producer: string; seq: number }> = [];
    const now = this.clock.now();
    for (const state of this.states) {
      while (
        state.gapSince !== null &&
        now >= state.gapSince + this.gapTimeoutMs
      ) {
        const seq = state.next;
        this.settle(state, seq, { kind: "skipped" });
        skipped.push({ producer: state.name, seq });
        this.drainBuffer(state);
        this.refreshGap(state);
      }
    }
    if (skipped.length > 0) {
      this.advanceJoin();
    }
    return { skipped };
  }

  poll(maxn?: number): JoinEvent[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new InvalidConfigError("maxn must be an integer >= 1");
    }
    const count =
      maxn === undefined ? this.joined.length : Math.min(maxn, this.joined.length);
    return this.joined.splice(0, count);
  }

  private stateOf(producer: string): ProducerState {
    const state = this.byName.get(producer);
    if (!state) {
      throw new UnknownProducerError(`unknown producer: ${producer}`);
    }
    return state;
  }

  private settle(state: ProducerState, seq: number, slot: Slot): void {
    state.slots.set(seq, slot);
    state.next = seq + 1;
  }

  private drainBuffer(state: ProducerState): void {
    while (state.buffer.has(state.next)) {
      const payload = state.buffer.get(state.next)!;
      state.buffer.delete(state.next);
      this.settle(state, state.next, { kind: "value", payload });
    }
  }

  private refreshGap(state: ProducerState): void {
    state.gapSince = state.buffer.size > 0 ? this.clock.now() : null;
  }

  private advanceJoin(): void {
    for (;;) {
      const seq = this.joinSeq;
      if (!this.states.every((s) => s.slots.has(seq))) {
        return;
      }
      const values: Record<string, string> = {};
      const missing: string[] = [];
      for (const state of this.states) {
        const slot = state.slots.get(seq)!;
        state.slots.delete(seq);
        if (slot.kind === "value") {
          values[state.name] = slot.payload;
        } else {
          missing.push(state.name);
        }
      }
      this.joined.push({ seq, values, missing });
      this.joinSeq = seq + 1;
    }
  }
}
