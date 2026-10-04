import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidRequestError,
  UnknownConsumerError,
} from "./errors.js";

export interface RingBufConfig {
  clock: VirtualClock;
  capacity: number;
}

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

interface Consumer {
  gen: number;
  nextSeq: number;
}

export class RingBuf {
  private readonly clock: VirtualClock;
  private readonly capacity: number;
  private readonly slots: (Entry | undefined)[];
  private count = 0;
  private head = 0;
  private newestSeq = 0;
  private readonly active = new Map<string, Consumer>();
  private readonly nextGen = new Map<string, number>();

  constructor(config: RingBufConfig) {
    if (
      !config ||
      !(config.clock instanceof VirtualClock) ||
      !Number.isInteger(config.capacity) ||
      config.capacity < 1
    ) {
      throw new InvalidConfigError(
        "RingBuf requires a VirtualClock and integer capacity >= 1",
      );
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
        `consumer "${consumerId}" is already subscribed`,
      );
    }
    const gen = this.nextGen.get(consumerId) ?? 1;
    this.nextGen.set(consumerId, gen + 1);
    const nextSeq = this.count > 0 ? this.oldestSeq() : this.newestSeq + 1;
    this.active.set(consumerId, { gen, nextSeq });
    return { gen, nextSeq };
  }

  unsubscribe(consumerId: string, gen: number): boolean {
    const consumer = this.requireConsumer(consumerId);
    if (consumer.gen !== gen) {
      throw new InvalidRequestError(`gen mismatch for consumer "${consumerId}"`);
    }
    this.active.delete(consumerId);
    return true;
  }

  publish(payload: string): PublishResult {
    if (typeof payload !== "string") {
      throw new InvalidRequestError("payload must be a string");
    }
    const seq = this.newestSeq + 1;
    let overwritten: number | null = null;
    if (this.count === this.capacity) {
      overwritten = this.slots[this.head]!.seq;
      this.slots[this.head] = { seq, payload, publishedAt: this.clock.now() };
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.slots[(this.head + this.count) % this.capacity] = {
        seq,
        payload,
        publishedAt: this.clock.now(),
      };
      this.count += 1;
    }
    this.newestSeq = seq;

    const oldest = this.oldestSeq();
    const lagged: string[] = [];
    for (const [id, consumer] of this.active) {
      if (consumer.nextSeq < oldest) {
        consumer.nextSeq = oldest;
        lagged.push(id);
      }
    }
    lagged.sort();
    return { seq, overwritten, lagged };
  }

  read(consumerId: string, gen: number, maxn = 1): Entry[] {
    const consumer = this.requireConsumer(consumerId);
    if (consumer.gen !== gen) {
      throw new InvalidRequestError(`gen mismatch for consumer "${consumerId}"`);
    }
    if (!Number.isInteger(maxn) || maxn < 1 || maxn > this.capacity) {
      throw new InvalidRequestError(
        `maxn must be an integer in 1..${this.capacity}`,
      );
    }
    if (this.count > 0) {
      const oldest = this.oldestSeq();
      if (consumer.nextSeq < oldest) {
        consumer.nextSeq = oldest;
      }
    }
    const out: Entry[] = [];
    while (
      out.length < maxn &&
      consumer.nextSeq <= this.newestSeq &&
      consumer.nextSeq >= this.oldestSeq()
    ) {
      const entry = this.entryAt(consumer.nextSeq);
      if (!entry) break;
      out.push({ ...entry });
      consumer.nextSeq += 1;
    }
    return out;
  }

  oldest(): number | null {
    return this.count === 0 ? null : this.oldestSeq();
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
    return this.slots[this.head]!.seq;
  }

  private entryAt(seq: number): Entry | undefined {
    const oldest = this.oldestSeq();
    if (seq < oldest || seq > this.newestSeq) return undefined;
    return this.slots[(this.head + (seq - oldest)) % this.capacity];
  }

  private requireConsumer(consumerId: string): Consumer {
    const consumer = this.active.get(consumerId);
    if (!consumer) {
      throw new UnknownConsumerError(`unknown consumer "${consumerId}"`);
    }
    return consumer;
  }
}
