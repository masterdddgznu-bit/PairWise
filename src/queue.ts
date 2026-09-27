import { VirtualClock } from "./clock.js";
import { DeadLetterQueue } from "./dlq.js";
import { EventLog } from "./events.js";
import { IdGen } from "./ids.js";
import { InflightMap } from "./inflight.js";
import type { EnqueueOpts, Message, QueueEvent } from "./types.js";
import { WaitingQueue } from "./waiting.js";

/**
 * Work queue.
 * Base FIFO enqueue/dequeue/ack/size work.
 * Feature methods wired to unfinished modules.
 */
export class WorkQueue {
  readonly clock: VirtualClock;
  /** @internal */ readonly ids: IdGen;
  /** @internal */ readonly waiting: WaitingQueue;
  /** @internal */ readonly inflight: InflightMap;
  /** @internal */ readonly dlq: DeadLetterQueue;
  /** @internal */ readonly events: EventLog;

  private visibilityTimeout = Number.POSITIVE_INFINITY;
  private maxAttempts = Number.POSITIVE_INFINITY;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.ids = new IdGen();
    this.waiting = new WaitingQueue();
    this.inflight = new InflightMap();
    this.dlq = new DeadLetterQueue();
    this.events = new EventLog();
  }

  setVisibilityTimeout(ms: number): void {
    this.visibilityTimeout = ms;
  }

  setMaxAttempts(n: number): void {
    this.maxAttempts = n;
  }

  /** @internal */
  getVisibilityTimeout(): number {
    return this.visibilityTimeout;
  }

  /** @internal */
  getMaxAttempts(): number {
    return this.maxAttempts;
  }

  enqueue(payload: string, opts?: EnqueueOpts): string {
    const id = this.ids.next();
    const now = this.clock.now();
    const msg: Message = {
      id,
      payload,
      priority: opts?.priority ?? 0,
      attempts: 0,
      enqueuedAt: now,
    };
    const delay = opts?.delayMs ?? 0;
    const availableAt = delay > 0 ? now + delay : now;
    this.waiting.enqueue(msg, availableAt);
    this.events.append("enqueue", id, now);
    return id;
  }

  dequeue(): Message | null {
    const now = this.clock.now();
    const item = this.waiting.takeReady(now);
    if (!item) return null;
    const msg: Message = {
      id: item.id,
      payload: item.payload,
      priority: item.priority,
      attempts: item.attempts,
      enqueuedAt: item.enqueuedAt,
    };
    const until =
      this.visibilityTimeout === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : now + this.visibilityTimeout;
    this.inflight.put(msg, until);
    this.events.append("dequeue", msg.id, now);
    return msg;
  }

  ack(messageId: string): boolean {
    const item = this.inflight.remove(messageId);
    if (!item) return false;
    this.events.append("ack", messageId, this.clock.now());
    return true;
  }

  nack(messageId: string): boolean {
    const item = this.inflight.remove(messageId);
    if (!item) return false;
    const now = this.clock.now();
    const msg: Message = {
      id: item.id,
      payload: item.payload,
      priority: item.priority,
      attempts: item.attempts + 1,
      enqueuedAt: item.enqueuedAt,
    };
    this.events.append("nack", messageId, now);
    if (msg.attempts >= this.maxAttempts) {
      this.dlq.push(msg);
      this.events.append("dead", messageId, now);
    } else {
      this.waiting.requeue(msg, now);
    }
    return true;
  }

  size(): number {
    return this.waiting.size(this.clock.now());
  }

  tick(): void {
    const now = this.clock.now();
    for (const item of this.inflight.expired(now)) {
      const msg: Message = {
        id: item.id,
        payload: item.payload,
        priority: item.priority,
        attempts: item.attempts + 1,
        enqueuedAt: item.enqueuedAt,
      };
      this.events.append("expire", msg.id, now);
      if (msg.attempts >= this.maxAttempts) {
        this.dlq.push(msg);
        this.events.append("dead", msg.id, now);
      } else {
        this.waiting.requeue(msg, now);
      }
    }
  }

  deadLetters(): Message[] {
    return this.dlq.list();
  }

  redrive(messageId: string): boolean {
    const msg = this.dlq.take(messageId);
    if (!msg) return false;
    const now = this.clock.now();
    this.waiting.requeue({ ...msg, attempts: 0 }, now);
    this.events.append("redrive", messageId, now);
    return true;
  }

  batchDequeue(n: number): Message[] {
    const now = this.clock.now();
    const items = this.waiting.takeReadyN(now, n);
    const out: Message[] = [];
    for (const item of items) {
      const msg: Message = {
        id: item.id,
        payload: item.payload,
        priority: item.priority,
        attempts: item.attempts,
        enqueuedAt: item.enqueuedAt,
      };
      const until =
        this.visibilityTimeout === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : now + this.visibilityTimeout;
      this.inflight.put(msg, until);
      this.events.append("dequeue", msg.id, now);
      out.push(msg);
    }
    return out;
  }

  currentSeq(): number {
    return this.events.currentSeq();
  }

  watch(fromSeq: number): string {
    return this.events.watch(fromSeq);
  }

  pollWatch(watchId: string): QueueEvent[] {
    return this.events.pollWatch(watchId);
  }

  unwatch(watchId: string): void {
    this.events.unwatch(watchId);
  }

  compact(beforeSeq: number): void {
    this.events.compact(beforeSeq);
  }
}
