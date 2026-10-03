import { VirtualClock } from "./clock.js";
import { FeatureNotReadyError, InvalidConfigError } from "./errors.js";
import { InboxBook } from "./inbox.js";
import { InflightBook } from "./inflight.js";
import { EventLog } from "./log.js";
import { assertPattern, matches, splitTopic } from "./matcher.js";
import type { Envelope, WatchBusOptions } from "./types.js";

export class WatchBus {
  readonly clock: VirtualClock;
  private readonly capacity: number;
  private readonly ackTimeoutMs: number;
  private readonly log: EventLog;
  private readonly inbox = new InboxBook();
  private readonly inflight = new InflightBook();
  private readonly exact = new Map<string, Set<string>>();
  private readonly patterns = new Map<string, Set<string>>();

  constructor(opts: WatchBusOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    const capacity = opts.capacity ?? 32;
    const ackTimeoutMs = opts.ackTimeoutMs ?? 100;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new InvalidConfigError("capacity");
    }
    if (!Number.isInteger(ackTimeoutMs) || ackTimeoutMs < 1) {
      throw new InvalidConfigError("ackTimeoutMs");
    }
    this.clock = opts.clock;
    this.capacity = capacity;
    this.ackTimeoutMs = ackTimeoutMs;
    this.log = new EventLog(capacity);
  }

  subscribe(topic: string, consumerId: string): void {
    splitTopic(topic);
    if (!consumerId) throw new InvalidConfigError("consumer");
    let set = this.exact.get(topic);
    if (!set) {
      set = new Set();
      this.exact.set(topic, set);
    }
    set.add(consumerId);
  }

  unsubscribe(topic: string, consumerId: string): void {
    this.exact.get(topic)?.delete(consumerId);
  }

  subscribePattern(pattern: string, consumerId: string): void {
    assertPattern(pattern);
    if (!consumerId) throw new InvalidConfigError("consumer");
    throw new FeatureNotReadyError("subscribePattern");
  }

  unsubscribePattern(pattern: string, consumerId: string): void {
    void pattern;
    void consumerId;
    throw new FeatureNotReadyError("unsubscribePattern");
  }

  private recipients(topic: string): string[] {
    const out = new Set<string>();
    for (const c of this.exact.get(topic) ?? []) out.add(c);
    for (const [pat, set] of this.patterns) {
      if (matches(pat, topic)) {
        for (const c of set) out.add(c);
      }
    }
    return [...out].sort();
  }

  publish(topic: string, payload: string): number {
    splitTopic(topic);
    const rec = this.log.append(topic, payload);
    const now = this.clock.now();
    for (const consumerId of this.recipients(topic)) {
      const env: Envelope = {
        seq: rec.seq,
        topic,
        payload,
        redelivery: false,
      };
      this.inbox.push(consumerId, env);
      this.inflight.track(consumerId, rec.seq, topic, payload, now);
    }
    return rec.seq;
  }

  poll(consumerId: string): Envelope[] {
    return this.inbox.poll(consumerId);
  }

  inboxSize(consumerId: string): number {
    return this.inbox.size(consumerId);
  }

  replay(consumerId: string, fromSeq: number): number {
    void consumerId;
    void fromSeq;
    throw new FeatureNotReadyError("replay");
  }

  ack(consumerId: string, seq: number): boolean {
    return this.inflight.ack(consumerId, seq);
  }

  nack(consumerId: string, seq: number): boolean {
    const got = this.inflight.nack(consumerId, seq, this.clock.now());
    if (!got) return false;
    this.inbox.push(consumerId, {
      seq,
      topic: got.topic,
      payload: got.payload,
      redelivery: true,
    });
    return true;
  }

  drive(): number {
    const due = this.inflight.due(this.clock.now(), this.ackTimeoutMs);
    const now = this.clock.now();
    for (const item of due) {
      this.inbox.push(item.consumerId, {
        seq: item.seq,
        topic: item.topic,
        payload: item.payload,
        redelivery: true,
      });
      this.inflight.refresh(item.consumerId, item.seq, now);
    }
    return due.length;
  }
}
