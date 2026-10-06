import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
} from "./errors.js";
import type { JournalEntry } from "./journal.js";

export interface IdemBoxOptions {
  clock: VirtualClock;
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

interface TopicLog {
  messages: Message[];
  nextSeq: number;
}

interface IdemWindow {
  seq: number;
  expireAt: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class IdemBox {
  private readonly clock: VirtualClock;
  private readonly idemTtlMs: number;
  private readonly maxTopics: number;
  private readonly maxDepth: number;
  private readonly maxIdem: number;

  private readonly logs = new Map<string, TopicLog>();
  private readonly idem = new Map<string, Map<string, IdemWindow>>();
  private readonly offsets = new Map<string, Map<string, number>>();
  private readonly wal: JournalEntry[] = [];

  constructor(opts: IdemBoxOptions) {
    if (!opts || typeof opts !== "object") {
      throw new InvalidConfigError("options are required");
    }
    if (!(opts.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    if (!isPositiveInt(opts.idemTtlMs)) {
      throw new InvalidConfigError("idemTtlMs must be an integer >= 1");
    }
    const maxTopics = opts.maxTopics ?? 8;
    const maxDepth = opts.maxDepth ?? 32;
    const maxIdem = opts.maxIdem ?? 64;
    if (!isPositiveInt(maxTopics)) {
      throw new InvalidConfigError("maxTopics must be an integer >= 1");
    }
    if (!isPositiveInt(maxDepth)) {
      throw new InvalidConfigError("maxDepth must be an integer >= 1");
    }
    if (!isPositiveInt(maxIdem)) {
      throw new InvalidConfigError("maxIdem must be an integer >= 1");
    }
    this.clock = opts.clock;
    this.idemTtlMs = opts.idemTtlMs;
    this.maxTopics = maxTopics;
    this.maxDepth = maxDepth;
    this.maxIdem = maxIdem;
  }

  static fromJournal(
    clock: VirtualClock,
    opts: Omit<IdemBoxOptions, "clock">,
    entries: JournalEntry[],
  ): IdemBox {
    const box = new IdemBox({ ...opts, clock });
    for (const entry of entries) {
      box.replay(entry);
      box.wal.push(entry);
    }
    return box;
  }

  private replay(entry: JournalEntry): void {
    switch (entry.type) {
      case "pub": {
        let log = this.logs.get(entry.topic);
        if (!log) {
          log = { messages: [], nextSeq: 1 };
          this.logs.set(entry.topic, log);
        }
        log.messages.push({
          seq: entry.seq,
          idemKey: entry.idemKey,
          payload: entry.payload,
        });
        log.nextSeq = entry.seq + 1;
        this.setIdem(entry.topic, entry.idemKey, {
          seq: entry.seq,
          expireAt: entry.expireAt,
        });
        break;
      }
      case "dup":
        break;
      case "commit": {
        let group = this.offsets.get(entry.group);
        if (!group) {
          group = new Map();
          this.offsets.set(entry.group, group);
        }
        group.set(entry.topic, entry.seq);
        break;
      }
      case "expire": {
        for (const { topic, idemKey } of entry.expired) {
          const windows = this.idem.get(topic);
          if (windows) {
            windows.delete(idemKey);
            if (windows.size === 0) this.idem.delete(topic);
          }
        }
        break;
      }
    }
  }

  private setIdem(topic: string, idemKey: string, window: IdemWindow): void {
    let windows = this.idem.get(topic);
    if (!windows) {
      windows = new Map();
      this.idem.set(topic, windows);
    }
    windows.set(idemKey, window);
  }

  private idemSize(): number {
    let size = 0;
    for (const windows of this.idem.values()) size += windows.size;
    return size;
  }

  publish(topic: string, idemKey: string, payload: unknown): PublishResult {
    if (typeof topic !== "string" || topic.length === 0) {
      throw new InvalidArgError("topic must be a non-empty string");
    }
    if (typeof idemKey !== "string" || idemKey.length === 0) {
      throw new InvalidArgError("idemKey must be a non-empty string");
    }

    const now = this.clock.now();
    const existing = this.idem.get(topic)?.get(idemKey);
    if (existing && now < existing.expireAt) {
      this.wal.push({ type: "dup", topic, idemKey, seq: existing.seq });
      return { seq: existing.seq, duplicate: true };
    }

    const isNewTopic = !this.logs.has(topic);
    if (isNewTopic && this.logs.size >= this.maxTopics) {
      throw new CapacityError("maxTopics exceeded");
    }
    const existingLog = this.logs.get(topic);
    if (existingLog && existingLog.messages.length >= this.maxDepth) {
      throw new CapacityError("maxDepth exceeded");
    }
    if (!existing && this.idemSize() >= this.maxIdem) {
      throw new CapacityError("maxIdem exceeded");
    }

    let target = this.logs.get(topic);
    if (!target) {
      target = { messages: [], nextSeq: 1 };
      this.logs.set(topic, target);
    }
    const seq = target.nextSeq;
    target.messages.push({ seq, idemKey, payload });
    target.nextSeq = seq + 1;
    const expireAt = now + this.idemTtlMs;
    this.setIdem(topic, idemKey, { seq, expireAt });
    this.wal.push({ type: "pub", topic, idemKey, payload, seq, expireAt });
    return { seq, duplicate: false };
  }

  poll(group: string, topic: string, maxn: number): Message[] {
    if (typeof group !== "string" || group.length === 0) {
      throw new InvalidArgError("group must be a non-empty string");
    }
    if (typeof topic !== "string" || topic.length === 0) {
      throw new InvalidArgError("topic must be a non-empty string");
    }
    if (!isPositiveInt(maxn)) {
      throw new InvalidArgError("maxn must be an integer >= 1");
    }
    const log = this.logs.get(topic);
    if (!log) return [];
    const offset = this.offsetOf(group, topic);
    const out: Message[] = [];
    for (const message of log.messages) {
      if (message.seq > offset) {
        out.push({
          seq: message.seq,
          idemKey: message.idemKey,
          payload: message.payload,
        });
        if (out.length >= maxn) break;
      }
    }
    return out;
  }

  commit(group: string, topic: string, seq: number): void {
    if (typeof group !== "string" || group.length === 0) {
      throw new InvalidArgError("group must be a non-empty string");
    }
    if (typeof topic !== "string" || topic.length === 0) {
      throw new InvalidArgError("topic must be a non-empty string");
    }
    if (!isPositiveInt(seq)) {
      throw new InvalidArgError("seq must be an integer >= 1");
    }
    const log = this.logs.get(topic);
    const head = log ? log.nextSeq - 1 : 0;
    if (seq > head) {
      throw new StateError("commit seq exceeds published head");
    }
    const current = this.offsetOf(group, topic);
    if (seq < current) {
      throw new StateError("commit seq regresses committed offset");
    }
    let offsets = this.offsets.get(group);
    if (!offsets) {
      offsets = new Map();
      this.offsets.set(group, offsets);
    }
    offsets.set(topic, seq);
    this.wal.push({ type: "commit", group, topic, seq });
  }

  offsetOf(group: string, topic: string): number {
    return this.offsets.get(group)?.get(topic) ?? 0;
  }

  drive(): { expired: Array<{ topic: string; idemKey: string }> } {
    const now = this.clock.now();
    const expired: Array<{ topic: string; idemKey: string }> = [];
    for (const [topic, windows] of this.idem) {
      for (const [idemKey, window] of windows) {
        if (now >= window.expireAt) expired.push({ topic, idemKey });
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
    for (const { topic, idemKey } of expired) {
      const windows = this.idem.get(topic);
      if (windows) {
        windows.delete(idemKey);
        if (windows.size === 0) this.idem.delete(topic);
      }
    }
    if (expired.length > 0) {
      this.wal.push({ type: "expire", expired });
    }
    return { expired };
  }

  depth(topic: string): number {
    return this.logs.get(topic)?.messages.length ?? 0;
  }

  topics(): string[] {
    return [...this.logs.keys()];
  }

  journal(): JournalEntry[] {
    return this.wal.slice();
  }
}
