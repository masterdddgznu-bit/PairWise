import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
} from "./errors.js";

export interface IdemBoxOptions {
  clock: VirtualClock;
  idemTtlMs: number;
  maxTopics?: number;
  maxDepth?: number;
  maxIdem?: number;
}

export interface JournalOptions {
  idemTtlMs: number;
  maxTopics?: number;
  maxDepth?: number;
  maxIdem?: number;
}

export interface PublishResult {
  seq: number;
  duplicate: boolean;
}

export interface Message {
  seq: number;
  idemKey: string;
  payload: unknown;
}

export type JournalEntry =
  | { type: "pub"; topic: string; idemKey: string; payload: unknown; seq: number; expireAt: number }
  | { type: "dup"; topic: string; idemKey: string; seq: number }
  | { type: "commit"; group: string; topic: string; seq: number }
  | { type: "expire"; expired: Array<{ topic: string; idemKey: string }> };

interface TopicState {
  messages: Message[];
  nextSeq: number;
}

interface IdemEntry {
  expireAt: number;
  seq: number;
}

const DEFAULT_MAX_TOPICS = 8;
const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_IDEM = 64;

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function requireNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidArgError(`${name} must be a non-empty string`);
  }
}

export class IdemBox {
  private readonly clock: VirtualClock;
  private readonly idemTtlMs: number;
  private readonly maxTopics: number;
  private readonly maxDepth: number;
  private readonly maxIdem: number;

  private readonly topicStates = new Map<string, TopicState>();
  private readonly idemEntries = new Map<string, Map<string, IdemEntry>>();
  private readonly offsets = new Map<string, Map<string, number>>();
  private readonly log: JournalEntry[] = [];

  constructor(opts: IdemBoxOptions) {
    if (!opts || typeof opts !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    const { clock, idemTtlMs, maxTopics, maxDepth, maxIdem } = opts;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!isPositiveInt(idemTtlMs)) {
      throw new InvalidConfigError("idemTtlMs must be an integer >= 1");
    }
    for (const [name, value] of [
      ["maxTopics", maxTopics],
      ["maxDepth", maxDepth],
      ["maxIdem", maxIdem],
    ] as const) {
      if (value !== undefined && !isPositiveInt(value)) {
        throw new InvalidConfigError(`${name} must be an integer >= 1`);
      }
    }
    this.clock = clock;
    this.idemTtlMs = idemTtlMs;
    this.maxTopics = maxTopics ?? DEFAULT_MAX_TOPICS;
    this.maxDepth = maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxIdem = maxIdem ?? DEFAULT_MAX_IDEM;
  }

  static fromJournal(clock: VirtualClock, opts: JournalOptions, entries: JournalEntry[]): IdemBox {
    const box = new IdemBox({ ...opts, clock });
    for (const entry of entries) {
      box.replay(entry);
    }
    return box;
  }

  private replay(entry: JournalEntry): void {
    switch (entry.type) {
      case "pub": {
        const topic = this.ensureTopic(entry.topic);
        topic.messages.push({ seq: entry.seq, idemKey: entry.idemKey, payload: entry.payload });
        topic.nextSeq = entry.seq + 1;
        this.setIdem(entry.topic, entry.idemKey, { expireAt: entry.expireAt, seq: entry.seq });
        break;
      }
      case "dup":
        break;
      case "commit": {
        this.setOffset(entry.group, entry.topic, entry.seq);
        break;
      }
      case "expire": {
        for (const { topic, idemKey } of entry.expired) {
          this.idemEntries.get(topic)?.delete(idemKey);
        }
        break;
      }
    }
    this.log.push(entry);
  }

  private ensureTopic(topic: string): TopicState {
    let state = this.topicStates.get(topic);
    if (!state) {
      state = { messages: [], nextSeq: 1 };
      this.topicStates.set(topic, state);
    }
    return state;
  }

  private setIdem(topic: string, idemKey: string, entry: IdemEntry): void {
    let perTopic = this.idemEntries.get(topic);
    if (!perTopic) {
      perTopic = new Map();
      this.idemEntries.set(topic, perTopic);
    }
    perTopic.set(idemKey, entry);
  }

  private idemCount(): number {
    let count = 0;
    for (const perTopic of this.idemEntries.values()) {
      count += perTopic.size;
    }
    return count;
  }

  private setOffset(group: string, topic: string, seq: number): void {
    let perGroup = this.offsets.get(group);
    if (!perGroup) {
      perGroup = new Map();
      this.offsets.set(group, perGroup);
    }
    perGroup.set(topic, seq);
  }

  publish(topic: string, idemKey: string, payload: unknown): PublishResult {
    requireNonEmpty(topic, "topic");
    requireNonEmpty(idemKey, "idemKey");
    const now = this.clock.now();

    const existing = this.idemEntries.get(topic)?.get(idemKey);
    if (existing && now < existing.expireAt) {
      this.log.push({ type: "dup", topic, idemKey, seq: existing.seq });
      return { seq: existing.seq, duplicate: true };
    }

    const topicState = this.topicStates.get(topic);
    if (!topicState && this.topicStates.size >= this.maxTopics) {
      throw new CapacityError(`topic capacity ${this.maxTopics} exceeded`);
    }
    if (topicState && topicState.messages.length >= this.maxDepth) {
      throw new CapacityError(`depth capacity ${this.maxDepth} exceeded for topic "${topic}"`);
    }
    if (!existing && this.idemCount() >= this.maxIdem) {
      throw new CapacityError(`idem capacity ${this.maxIdem} exceeded`);
    }

    const state = this.ensureTopic(topic);
    const seq = state.nextSeq;
    const expireAt = now + this.idemTtlMs;
    state.messages.push({ seq, idemKey, payload });
    state.nextSeq = seq + 1;
    this.setIdem(topic, idemKey, { expireAt, seq });
    this.log.push({ type: "pub", topic, idemKey, payload, seq, expireAt });
    return { seq, duplicate: false };
  }

  poll(group: string, topic: string, maxn: number): Message[] {
    requireNonEmpty(group, "group");
    requireNonEmpty(topic, "topic");
    if (!isPositiveInt(maxn)) {
      throw new InvalidArgError("maxn must be an integer >= 1");
    }
    const offset = this.offsetOf(group, topic);
    const state = this.topicStates.get(topic);
    if (!state) {
      return [];
    }
    const result: Message[] = [];
    for (const message of state.messages) {
      if (message.seq > offset) {
        result.push({ seq: message.seq, idemKey: message.idemKey, payload: message.payload });
        if (result.length >= maxn) {
          break;
        }
      }
    }
    return result;
  }

  commit(group: string, topic: string, seq: number): void {
    requireNonEmpty(group, "group");
    requireNonEmpty(topic, "topic");
    if (!isPositiveInt(seq)) {
      throw new InvalidArgError("seq must be an integer >= 1");
    }
    const state = this.topicStates.get(topic);
    const maxSeq = state ? state.nextSeq - 1 : 0;
    if (seq > maxSeq) {
      throw new StateError(`seq ${seq} exceeds max published seq ${maxSeq} for topic "${topic}"`);
    }
    const current = this.offsetOf(group, topic);
    if (seq < current) {
      throw new StateError(`commit offset cannot regress from ${current} to ${seq}`);
    }
    this.setOffset(group, topic, seq);
    this.log.push({ type: "commit", group, topic, seq });
  }

  offsetOf(group: string, topic: string): number {
    return this.offsets.get(group)?.get(topic) ?? 0;
  }

  drive(): { expired: Array<{ topic: string; idemKey: string }> } {
    const now = this.clock.now();
    const expired: Array<{ topic: string; idemKey: string }> = [];
    for (const [topic, perTopic] of this.idemEntries) {
      for (const [idemKey, entry] of perTopic) {
        if (now >= entry.expireAt) {
          perTopic.delete(idemKey);
          expired.push({ topic, idemKey });
        }
      }
    }
    expired.sort((a, b) =>
      a.topic === b.topic
        ? a.idemKey < b.idemKey
          ? -1
          : a.idemKey > b.idemKey
            ? 1
            : 0
        : a.topic < b.topic
          ? -1
          : 1,
    );
    if (expired.length > 0) {
      this.log.push({ type: "expire", expired: expired.map((e) => ({ ...e })) });
    }
    return { expired };
  }

  depth(topic: string): number {
    return this.topicStates.get(topic)?.messages.length ?? 0;
  }

  topics(): string[] {
    return [...this.topicStates.keys()];
  }

  journal(): JournalEntry[] {
    return this.log.map((entry) =>
      entry.type === "expire"
        ? { type: "expire", expired: entry.expired.map((e) => ({ ...e })) }
        : { ...entry },
    );
  }
}
