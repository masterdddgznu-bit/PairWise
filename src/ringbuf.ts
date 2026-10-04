import type { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidRequestError,
  UnknownConsumerError,
} from "./errors.js";

export interface Entry {
  seq: number;
  payload: string;
  publishedAt: number;
}

export interface SubscribeResult {
  gen: number;
  nextSeq: number;
}

export interface PublishResult {
  seq: number;
  overwritten: number | null;
  lagged: string[];
}

export interface RingBufConfig {
  clock: VirtualClock;
  capacity: number;
}

interface ConsumerState {
  gen: number;
  nextSeq: number;
}

export class RingBuf {
  private readonly clock: VirtualClock;
  private readonly capacity: number;
  private readonly slots: (Entry | undefined)[];
  private count = 0;
  private newestSeq = 0;
  private readonly active = new Map<string, ConsumerState>();
  private readonly lastGen = new Map<string, number>();

  constructor(config: RingBufConfig) {
    if (
      config === null ||
      typeof config !== "object" ||
      !Number.isInteger(config.capacity) ||
      config.capacity < 1
    ) {
      throw new InvalidConfigError("capacity must be an integer >= 1");
    }
    if (
      config.clock === null ||
      typeof config.clock !== "object" ||
      typeof config.clock.now !== "function"
    ) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    this.clock = config.clock;
    this.capacity = config.capacity;
    this.slots = new Array<Entry | undefined>(this.capacity);
  }

  subscribe(consumerId: string): SubscribeResult {
    if (typeof consumerId !== "string" || consumerId.length === 0) {
      throw new InvalidRequestError("consumerId must be a non-empty string");
    }
    if (this.active.has(consumerId)) {
      throw new InvalidRequestError(
        `consumer already subscribed: ${consumerId}`,
      );
    }
    const gen = (this.lastGen.get(consumerId) ?? 0) + 1;
    this.lastGen.set(consumerId, gen);
    const nextSeq = this.count > 0 ? this.oldestSeq() : this.newestSeq + 1;
    this.active.set(consumerId, { gen, nextSeq });
    return { gen, nextSeq };
  }

  unsubscribe(consumerId: string, gen: number): boolean {
    const state = this.requireConsumer(consumerId);
    if (state.gen !== gen) {
      throw new InvalidRequestError(
        `gen mismatch for consumer: ${consumerId}`,
      );
    }
    this.active.delete(consumerId);
    return true;
  }

  publish(payload: string): PublishResult {
    if (typeof payload !== "string") {
      throw new InvalidRequestError("payload must be a string");
    }
    const seq = this.newestSeq + 1;
    const overwritten = this.count === this.capacity ? this.oldestSeq() : null;
    this.slots[seq % this.capacity] = {
      seq,
      payload,
      publishedAt: this.clock.now(),
    };
    if (this.count < this.capacity) {
      this.count += 1;
    }
    this.newestSeq = seq;
    const oldest = this.oldestSeq();
    const lagged: string[] = [];
    for (const [id, state] of this.active) {
      if (state.nextSeq < oldest) {
        state.nextSeq = oldest;
        lagged.push(id);
      }
    }
    lagged.sort();
    return { seq, overwritten, lagged };
  }

  read(consumerId: string, gen: number, maxn = 1): Entry[] {
    const state = this.requireConsumer(consumerId);
    if (state.gen !== gen) {
      throw new InvalidRequestError(
        `gen mismatch for consumer: ${consumerId}`,
      );
    }
    if (!Number.isInteger(maxn) || maxn < 1 || maxn > this.capacity) {
      throw new InvalidRequestError(
        `maxn must be an integer in 1..${this.capacity}`,
      );
    }
    if (this.count > 0 && state.nextSeq < this.oldestSeq()) {
      state.nextSeq = this.oldestSeq();
    }
    const out: Entry[] = [];
    while (out.length < maxn && state.nextSeq <= this.newestSeq) {
      const entry = this.slots[state.nextSeq % this.capacity];
      if (entry === undefined || entry.seq !== state.nextSeq) {
        break;
      }
      out.push({ ...entry });
      state.nextSeq += 1;
    }
    return out;
  }

  oldest(): number | null {
    return this.count > 0 ? this.oldestSeq() : null;
  }

  newest(): number {
    return this.newestSeq;
  }

  size(): number {
    return this.count;
  }

  nextSeqOf(consumerId: string): number {
    return this.requireConsumer(consumerId).nextSeq;
  }

  genOf(consumerId: string): number {
    return this.requireConsumer(consumerId).gen;
  }

  consumers(): string[] {
    return [...this.active.keys()].sort();
  }

  private oldestSeq(): number {
    return this.newestSeq - this.count + 1;
  }

  private requireConsumer(consumerId: string): ConsumerState {
    const state = this.active.get(consumerId);
    if (state === undefined) {
      throw new UnknownConsumerError(`unknown consumer: ${consumerId}`);
    }
    return state;
  }
}
