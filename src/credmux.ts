import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  UnknownStreamError,
  StreamClosedError,
  FenceError,
  StreamLimitError,
  InvalidRequestError,
} from "./errors.js";

export interface CredMuxConfig {
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
  seq: number;
  queue: Delivery[];
  pending: string[];
  lastActiveAt: number;
}

export class CredMux {
  private readonly clock: VirtualClock;
  private readonly initialCredit: number;
  private readonly maxCredit: number;
  private readonly idleTimeoutMs: number;
  private readonly maxStreams: number;
  private readonly maxPending: number;
  private readonly streams = new Map<string, StreamState>();
  private readonly lastGen = new Map<string, number>();

  constructor(config: CredMuxConfig) {
    const {
      clock,
      initialCredit,
      maxCredit,
      idleTimeoutMs,
      maxStreams = 64,
      maxPending = 16,
    } = config;
    if (
      !clock ||
      !Number.isInteger(initialCredit) ||
      initialCredit < 0 ||
      !Number.isInteger(maxCredit) ||
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
      throw new StreamLimitError("max streams reached");
    }
    const gen = (this.lastGen.get(streamId) ?? 0) + 1;
    this.lastGen.set(streamId, gen);
    const state: StreamState = {
      id: streamId,
      gen,
      credit: this.initialCredit,
      closed: false,
      seq: 0,
      queue: [],
      pending: [],
      lastActiveAt: this.clock.now(),
    };
    this.streams.set(streamId, state);
    return { gen, credit: state.credit };
  }

  close(streamId: string, gen: number): boolean {
    const s = this.getStream(streamId);
    this.assertGen(s, gen);
    if (s.closed) {
      return false;
    }
    this.doClose(s);
    return true;
  }

  reset(streamId: string, gen: number): number {
    const s = this.getStream(streamId);
    this.assertGen(s, gen);
    this.assertOpen(s);
    s.gen += 1;
    this.lastGen.set(streamId, s.gen);
    s.credit = this.initialCredit;
    s.queue = [];
    s.pending = [];
    s.seq = 0;
    s.lastActiveAt = this.clock.now();
    return s.gen;
  }

  send(streamId: string, gen: number, payload: string): SendResult {
    if (typeof payload !== "string") {
      throw new InvalidRequestError("payload must be a string");
    }
    const s = this.getStream(streamId);
    this.assertGen(s, gen);
    this.assertOpen(s);
    s.lastActiveAt = this.clock.now();
    if (s.credit >= 1) {
      s.credit -= 1;
      s.seq += 1;
      s.queue.push({ seq: s.seq, payload });
      return { status: "sent", seq: s.seq, credit: s.credit };
    }
    if (s.pending.length >= this.maxPending) {
      throw new InvalidRequestError("pending queue full");
    }
    s.pending.push(payload);
    return { status: "pending", pending: s.pending.length };
  }

  grant(streamId: string, gen: number, n: number): number {
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidRequestError("grant amount must be an integer >= 1");
    }
    const s = this.getStream(streamId);
    this.assertGen(s, gen);
    this.assertOpen(s);
    s.credit = Math.min(this.maxCredit, s.credit + n);
    while (s.credit >= 1 && s.pending.length > 0) {
      const payload = s.pending.shift() as string;
      s.credit -= 1;
      s.seq += 1;
      s.queue.push({ seq: s.seq, payload });
    }
    s.lastActiveAt = this.clock.now();
    return s.credit;
  }

  poll(streamId: string, gen: number, maxn?: number): Delivery[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new InvalidRequestError("maxn must be an integer >= 1");
    }
    const s = this.getStream(streamId);
    this.assertGen(s, gen);
    this.assertOpen(s);
    const count = maxn === undefined ? s.queue.length : Math.min(maxn, s.queue.length);
    const out = s.queue.splice(0, count);
    s.lastActiveAt = this.clock.now();
    return out;
  }

  creditOf(streamId: string): number {
    return this.getStream(streamId).credit;
  }

  genOf(streamId: string): number {
    return this.getStream(streamId).gen;
  }

  pendingOf(streamId: string): number {
    return this.getStream(streamId).pending.length;
  }

  queuedOf(streamId: string): number {
    return this.getStream(streamId).queue.length;
  }

  openIds(): string[] {
    const ids: string[] = [];
    for (const s of this.streams.values()) {
      if (!s.closed) {
        ids.push(s.id);
      }
    }
    return ids.sort();
  }

  drive(): { idleClosed: string[] } {
    const now = this.clock.now();
    const idleClosed: string[] = [];
    for (const s of this.streams.values()) {
      if (!s.closed && now >= s.lastActiveAt + this.idleTimeoutMs) {
        this.doClose(s);
        idleClosed.push(s.id);
      }
    }
    return { idleClosed: idleClosed.sort() };
  }

  private doClose(s: StreamState): void {
    s.closed = true;
    s.credit = 0;
    s.queue = [];
    s.pending = [];
  }

  private openCount(): number {
    let n = 0;
    for (const s of this.streams.values()) {
      if (!s.closed) {
        n += 1;
      }
    }
    return n;
  }

  private assertValidId(streamId: string): void {
    if (typeof streamId !== "string" || streamId.length === 0) {
      throw new InvalidRequestError("streamId must be a non-empty string");
    }
  }

  private getStream(streamId: string): StreamState {
    const s = this.streams.get(streamId);
    if (!s) {
      throw new UnknownStreamError(`unknown stream: ${streamId}`);
    }
    return s;
  }

  private assertGen(s: StreamState, gen: number): void {
    if (gen !== s.gen) {
      throw new FenceError(
        `gen mismatch for stream ${s.id}: expected ${s.gen}, got ${gen}`,
      );
    }
  }

  private assertOpen(s: StreamState): void {
    if (s.closed) {
      throw new StreamClosedError(`stream closed: ${s.id}`);
    }
  }
}
