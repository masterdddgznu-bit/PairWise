import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidBatchError,
  InvalidConfigError,
  InvalidPinError,
  UnknownBatchError,
} from "./errors.js";

export type BatchStatus =
  | "open"
  | "sealed"
  | "committed"
  | "aborted"
  | "timedout";

export type PinResult =
  | { status: "pinned" }
  | { status: "waiting"; ticket: number };

export interface PinBatchOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxKeysPerBatch?: number;
  maxWaitersPerKey?: number;
}

interface Batch {
  id: number;
  holderId: string;
  fence: number;
  status: BatchStatus;
  deadline: number;
  keys: Set<string>;
}

interface Waiter {
  ticket: number;
  batchId: number;
  holderId: string;
  key: string;
  state: "waiting" | "cancelled" | "promoted";
}

const DEFAULT_MAX_KEYS_PER_BATCH = 8;
const DEFAULT_MAX_WAITERS_PER_KEY = 8;

export class PinBatch {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxKeysPerBatch: number;
  private readonly maxWaitersPerKey: number;

  private nextBatchId = 0;
  private nextFence = 0;
  private nextTicket = 0;

  private readonly batches = new Map<number, Batch>();
  private readonly keyHolder = new Map<string, number>();
  private readonly waitQueues = new Map<string, number[]>();
  private readonly waiters = new Map<number, Waiter>();

  constructor(options: PinBatchOptions) {
    const maxKeysPerBatch =
      options.maxKeysPerBatch ?? DEFAULT_MAX_KEYS_PER_BATCH;
    const maxWaitersPerKey =
      options.maxWaitersPerKey ?? DEFAULT_MAX_WAITERS_PER_KEY;
    if (!options || !(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    if (
      typeof options.leaseMs !== "number" ||
      !Number.isFinite(options.leaseMs) ||
      options.leaseMs < 1
    ) {
      throw new InvalidConfigError("leaseMs must be a finite number >= 1");
    }
    if (!Number.isInteger(maxKeysPerBatch) || maxKeysPerBatch < 1) {
      throw new InvalidConfigError("maxKeysPerBatch must be an integer >= 1");
    }
    if (!Number.isInteger(maxWaitersPerKey) || maxWaitersPerKey < 1) {
      throw new InvalidConfigError("maxWaitersPerKey must be an integer >= 1");
    }
    this.clock = options.clock;
    this.leaseMs = options.leaseMs;
    this.maxKeysPerBatch = maxKeysPerBatch;
    this.maxWaitersPerKey = maxWaitersPerKey;
  }

  open(holderId: string): { batchId: number; fence: number } {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidBatchError("holderId must be a non-empty string");
    }
    for (const batch of this.batches.values()) {
      if (
        batch.holderId === holderId &&
        (batch.status === "open" || batch.status === "sealed")
      ) {
        throw new InvalidBatchError(
          `holder '${holderId}' already has an active batch`,
        );
      }
    }
    const batchId = ++this.nextBatchId;
    const fence = ++this.nextFence;
    this.batches.set(batchId, {
      id: batchId,
      holderId,
      fence,
      status: "open",
      deadline: this.clock.now() + this.leaseMs,
      keys: new Set<string>(),
    });
    return { batchId, fence };
  }

  pin(
    holderId: string,
    batchId: number,
    fence: number,
    key: string,
  ): PinResult {
    const batch = this.getBatch(batchId);
    if (fence !== batch.fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (holderId !== batch.holderId) {
      throw new InvalidPinError(`batch ${batchId} is not held by this holder`);
    }
    if (batch.status !== "open") {
      throw new InvalidPinError(`batch ${batchId} is not open`);
    }
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidPinError("key must be a non-empty string");
    }
    if (batch.keys.has(key) || this.hasWaitingOn(batch.id, key)) {
      throw new InvalidPinError(
        `batch ${batchId} already pins or waits on key '${key}'`,
      );
    }
    if (batch.keys.size >= this.maxKeysPerBatch) {
      throw new InvalidPinError(`batch ${batchId} is full`);
    }
    if (!this.keyHolder.has(key)) {
      batch.keys.add(key);
      this.keyHolder.set(key, batch.id);
      return { status: "pinned" };
    }
    const queue = this.waitQueues.get(key) ?? [];
    if (queue.length >= this.maxWaitersPerKey) {
      throw new InvalidPinError(`wait queue for key '${key}' is full`);
    }
    const ticket = ++this.nextTicket;
    queue.push(ticket);
    this.waitQueues.set(key, queue);
    this.waiters.set(ticket, {
      ticket,
      batchId: batch.id,
      holderId,
      key,
      state: "waiting",
    });
    return { status: "waiting", ticket };
  }

  seal(holderId: string, batchId: number, fence: number): boolean {
    const batch = this.getBatch(batchId);
    if (fence !== batch.fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (holderId !== batch.holderId || batch.status !== "open") {
      return false;
    }
    if (this.hasPendingWait(batch.id)) {
      throw new InvalidBatchError(
        `batch ${batchId} has unresolved waiting pins`,
      );
    }
    batch.status = "sealed";
    batch.deadline = this.clock.now() + this.leaseMs;
    return true;
  }

  commit(holderId: string, batchId: number, fence: number): boolean {
    const batch = this.getBatch(batchId);
    if (fence !== batch.fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (holderId !== batch.holderId || batch.status !== "sealed") {
      return false;
    }
    batch.status = "committed";
    this.releaseKeys(batch);
    this.promoteAll();
    return true;
  }

  abort(holderId: string, batchId: number, fence: number): boolean {
    const batch = this.getBatch(batchId);
    if (fence !== batch.fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (
      holderId !== batch.holderId ||
      (batch.status !== "open" && batch.status !== "sealed")
    ) {
      return false;
    }
    this.terminate(batch, "aborted");
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const waiter = this.waiters.get(ticket);
    if (!waiter) {
      throw new InvalidPinError(`unknown ticket ${ticket}`);
    }
    if (waiter.holderId !== holderId || waiter.state !== "waiting") {
      return false;
    }
    this.removeFromQueue(waiter);
    waiter.state = "cancelled";
    return true;
  }

  drive(): { timedOut: number[] } {
    const now = this.clock.now();
    const timedOut: number[] = [];
    for (const batch of this.batches.values()) {
      if (
        (batch.status === "open" || batch.status === "sealed") &&
        now >= batch.deadline
      ) {
        this.terminate(batch, "timedout");
        timedOut.push(batch.id);
      }
    }
    this.promoteAll();
    timedOut.sort((a, b) => a - b);
    return { timedOut };
  }

  statusOf(batchId: number): BatchStatus {
    return this.getBatch(batchId).status;
  }

  keysOf(batchId: number): string[] {
    return [...this.getBatch(batchId).keys].sort();
  }

  holderOfKey(key: string): string | undefined {
    const batchId = this.keyHolder.get(key);
    if (batchId === undefined) {
      return undefined;
    }
    return this.batches.get(batchId)?.holderId;
  }

  waitingTickets(key: string): number[] {
    return [...(this.waitQueues.get(key) ?? [])];
  }

  private getBatch(batchId: number): Batch {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new UnknownBatchError(`unknown batch ${batchId}`);
    }
    return batch;
  }

  private terminate(batch: Batch, status: BatchStatus): void {
    batch.status = status;
    this.cancelWaitsOf(batch.id);
    this.releaseKeys(batch);
    this.promoteAll();
  }

  private releaseKeys(batch: Batch): void {
    for (const key of batch.keys) {
      if (this.keyHolder.get(key) === batch.id) {
        this.keyHolder.delete(key);
      }
    }
    batch.keys.clear();
  }

  private cancelWaitsOf(batchId: number): void {
    for (const waiter of this.waiters.values()) {
      if (waiter.batchId === batchId && waiter.state === "waiting") {
        this.removeFromQueue(waiter);
        waiter.state = "cancelled";
      }
    }
  }

  private removeFromQueue(waiter: Waiter): void {
    const queue = this.waitQueues.get(waiter.key);
    if (!queue) {
      return;
    }
    const index = queue.indexOf(waiter.ticket);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.waitQueues.delete(waiter.key);
    }
  }

  private hasPendingWait(batchId: number): boolean {
    for (const waiter of this.waiters.values()) {
      if (waiter.batchId === batchId && waiter.state === "waiting") {
        return true;
      }
    }
    return false;
  }

  private hasWaitingOn(batchId: number, key: string): boolean {
    for (const waiter of this.waiters.values()) {
      if (
        waiter.batchId === batchId &&
        waiter.key === key &&
        waiter.state === "waiting"
      ) {
        return true;
      }
    }
    return false;
  }

  private promoteAll(): void {
    for (const [key, queue] of this.waitQueues) {
      while (queue.length > 0 && !this.keyHolder.has(key)) {
        const ticket = queue[0];
        const waiter = this.waiters.get(ticket);
        queue.shift();
        if (!waiter) {
          continue;
        }
        const batch = this.batches.get(waiter.batchId);
        const canAccept =
          batch !== undefined &&
          batch.status === "open" &&
          batch.keys.size < this.maxKeysPerBatch &&
          !batch.keys.has(key);
        if (canAccept) {
          waiter.state = "promoted";
          batch.keys.add(key);
          this.keyHolder.set(key, batch.id);
        } else {
          waiter.state = "cancelled";
        }
      }
      if (queue.length === 0) {
        this.waitQueues.delete(key);
      }
    }
  }
}
