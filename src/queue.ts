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
    // Starter: delay ignored (always available now) — feature must honor delayMs.
    const availableAt = delay > 0 ? now + delay : now;
    // On starter path for base tests delay is 0.
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
    void messageId;
    throw new Error("nack not implemented");
  }

  size(): number {
    return this.waiting.size(this.clock.now());
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  deadLetters(): Message[] {
    return this.dlq.list();
  }

  redrive(messageId: string): boolean {
    void messageId;
    throw new Error("redrive not implemented");
  }

  batchDequeue(n: number): Message[] {
    void n;
    throw new Error("batchDequeue not implemented");
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
