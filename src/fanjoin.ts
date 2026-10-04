import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  UnknownProducerError,
  InvalidSeqError,
  FanJoinError,
} from "./errors.js";

export type JoinEvent = {
  seq: number;
  values: Record<string, string>;
  missing: string[];
};

export type PushResult = "accepted" | "duplicate" | "dropped";

export interface FanJoinOptions {
  clock: VirtualClock;
  producers: string[];
  bufSize: number;
  gapTimeoutMs: number;
}

type Slot =
  | { kind: "value"; payload: string }
  | { kind: "skipped" };

interface ProducerState {
  name: string;
  next: number;
  buffer: Map<number, string>;
  gapSince: number | null;
  slots: Map<number, Slot>;
}

export class FanJoin {
  private readonly clock: VirtualClock;
  private readonly bufSize: number;
  private readonly gapTimeoutMs: number;
  private readonly names: string[];
  private readonly states: Map<string, ProducerState>;
  private joinSeq = 1;
  private readonly queue: JoinEvent[] = [];

  constructor(opts: FanJoinOptions) {
    if (
      opts == null ||
      !(opts.clock instanceof VirtualClock) ||
      !Array.isArray(opts.producers) ||
      opts.producers.length === 0 ||
      opts.producers.some((p) => typeof p !== "string" || p.length === 0) ||
      new Set(opts.producers).size !== opts.producers.length ||
      !Number.isInteger(opts.bufSize) ||
      opts.bufSize < 1 ||
      !Number.isInteger(opts.gapTimeoutMs) ||
      opts.gapTimeoutMs < 1
    ) {
      throw new InvalidConfigError("invalid FanJoin configuration");
    }
    this.clock = opts.clock;
    this.bufSize = opts.bufSize;
    this.gapTimeoutMs = opts.gapTimeoutMs;
    this.names = [...opts.producers].sort();
    this.states = new Map(
      this.names.map((name) => [
        name,
        {
          name,
          next: 1,
          buffer: new Map<number, string>(),
          gapSince: null,
          slots: new Map<number, Slot>(),
        },
      ]),
    );
  }

  producers(): string[] {
    return [...this.names];
  }

  joinNext(): number {
    return this.joinSeq;
  }

  nextOf(producer: string): number {
    return this.stateOf(producer).next;
  }

  bufferedOf(producer: string): number {
    return this.stateOf(producer).buffer.size;
  }

  push(producer: string, seq: number, payload: string): PushResult {
    const st = this.stateOf(producer);
    if (!Number.isInteger(seq) || seq < 1) {
      throw new InvalidSeqError(`invalid seq: ${String(seq)}`);
    }
    if (seq < st.next) {
      return "duplicate";
    }
    if (seq === st.next) {
      this.settle(st, seq, { kind: "value", payload });
      this.refreshGapAfterFill(st);
      this.advanceJoin();
      return "accepted";
    }
    if (st.buffer.has(seq)) {
      return "duplicate";
    }
    if (st.buffer.size >= this.bufSize) {
      return "dropped";
    }
    st.buffer.set(seq, payload);
    if (st.gapSince === null) {
      st.gapSince = this.clock.now();
    }
    return "accepted";
  }

  drive(): { skipped: Array<{ producer: string; seq: number }> } {
    const skipped: Array<{ producer: string; seq: number }> = [];
    for (const name of this.names) {
      const st = this.states.get(name)!;
      while (
        st.gapSince !== null &&
        this.clock.now() >= st.gapSince + this.gapTimeoutMs
      ) {
        const seq = st.next;
        this.settle(st, seq, { kind: "skipped" });
        skipped.push({ producer: name, seq });
        if (st.buffer.size > 0) {
          st.gapSince = this.clock.now();
        } else {
          st.gapSince = null;
        }
      }
    }
    this.advanceJoin();
    return { skipped };
  }

  poll(maxn?: number): JoinEvent[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new FanJoinError("poll maxn must be an integer >= 1");
    }
    const n = maxn === undefined ? this.queue.length : Math.min(maxn, this.queue.length);
    return this.queue.splice(0, n);
  }

  private stateOf(producer: string): ProducerState {
    const st = this.states.get(producer);
    if (st === undefined) {
      throw new UnknownProducerError(`unknown producer: ${producer}`);
    }
    return st;
  }

  private settle(st: ProducerState, seq: number, slot: Slot): void {
    st.slots.set(seq, slot);
    st.next = seq + 1;
    while (st.buffer.has(st.next)) {
      const payload = st.buffer.get(st.next)!;
      st.buffer.delete(st.next);
      st.slots.set(st.next, { kind: "value", payload });
      st.next++;
    }
  }

  private refreshGapAfterFill(st: ProducerState): void {
    st.gapSince = st.buffer.size > 0 ? this.clock.now() : null;
  }

  private advanceJoin(): void {
    for (;;) {
      const ready = this.names.every((name) =>
        this.states.get(name)!.slots.has(this.joinSeq),
      );
      if (!ready) {
        return;
      }
      const values: Record<string, string> = {};
      const missing: string[] = [];
      for (const name of this.names) {
        const slot = this.states.get(name)!.slots.get(this.joinSeq)!;
        if (slot.kind === "value") {
          values[name] = slot.payload;
        } else {
          missing.push(name);
        }
      }
      this.queue.push({ seq: this.joinSeq, values, missing });
      this.joinSeq++;
    }
  }
}
