export class PinBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinBatchError";
  }
}

export class InvalidConfigError extends PinBatchError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}

export class InvalidBatchError extends PinBatchError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBatchError";
  }
}

export class FenceError extends PinBatchError {
  constructor(message: string) {
    super(message);
    this.name = "FenceError";
  }
}

export class UnknownBatchError extends PinBatchError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownBatchError";
  }
}

export class InvalidPinError extends PinBatchError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPinError";
  }
}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new PinBatchError(`cannot advance clock by ${ms}`);
    }
    this.t += ms;
  }
}

export type BatchStatus =
  | "open"
  | "sealed"
  | "committed"
  | "aborted"
  | "timedout";

interface Batch {
  id: number;
  holder: string;
  fence: number;
  deadline: number;
  status: BatchStatus;
  keys: Set<string>;
}

interface Waiter {
  ticket: number;
  batchId: number;
  holderId: string;
  key: string;
  state: "waiting" | "settled" | "cancelled";
}

export interface PinBatchOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxKeysPerBatch?: number;
  maxWaitersPerKey?: number;
}

export type PinResult =
  | { status: "pinned" }
  | { status: "waiting"; ticket: number };

export class PinBatch {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxKeysPerBatch: number;
  private readonly maxWaitersPerKey: number;

  private nextBatchId = 1;
  private nextFence = 1;
  private nextTicket = 1;

  private readonly batches = new Map<number, Batch>();
  private readonly occupancy = new Map<string, number>();
  private readonly queues = new Map<string, Waiter[]>();
  private readonly tickets = new Map<number, Waiter>();

  constructor(options: PinBatchOptions) {
    const leaseMs = options.leaseMs;
    const maxKeysPerBatch = options.maxKeysPerBatch ?? 8;
    const maxWaitersPerKey = options.maxWaitersPerKey ?? 8;
    if (!Number.isInteger(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError(
        `leaseMs must be an integer >= 1, got ${leaseMs}`,
      );
    }
    if (!Number.isInteger(maxKeysPerBatch) || maxKeysPerBatch < 1) {
      throw new InvalidConfigError(
        `maxKeysPerBatch must be an integer >= 1, got ${maxKeysPerBatch}`,
      );
    }
    if (!Number.isInteger(maxWaitersPerKey) || maxWaitersPerKey < 1) {
      throw new InvalidConfigError(
        `maxWaitersPerKey must be an integer >= 1, got ${maxWaitersPerKey}`,
      );
    }
    this.clock = options.clock;
    this.leaseMs = leaseMs;
    this.maxKeysPerBatch = maxKeysPerBatch;
    this.maxWaitersPerKey = maxWaitersPerKey;
  }

  open(holderId: string): { batchId: number; fence: number } {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidBatchError("holderId must be a non-empty string");
    }
    for (const batch of this.batches.values()) {
      if (
        batch.holder === holderId &&
        (batch.status === "open" || batch.status === "sealed")
      ) {
        throw new InvalidBatchError(
          `holder ${holderId} already has an active batch`,
        );
      }
    }
    const batch: Batch = {
      id: this.nextBatchId++,
      holder: holderId,
      fence: this.nextFence++,
      deadline: this.clock.now() + this.leaseMs,
      status: "open",
      keys: new Set<string>(),
    };
    this.batches.set(batch.id, batch);
    return { batchId: batch.id, fence: batch.fence };
  }

  pin(
    holderId: string,
    batchId: number,
    fence: number,
    key: string,
  ): PinResult {
    const batch = this.mustGet(batchId);
    if (batch.fence !== fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (batch.holder !== holderId) {
      throw new InvalidPinError(`batch ${batchId} belongs to another holder`);
    }
    if (batch.status !== "open") {
      throw new InvalidPinError(`batch ${batchId} is not open`);
    }
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidPinError("key must be a non-empty string");
    }
    if (batch.keys.has(key)) {
      throw new InvalidPinError(`batch ${batchId} already pinned key ${key}`);
    }
    if (batch.keys.size >= this.maxKeysPerBatch) {
      throw new InvalidPinError(`batch ${batchId} is full`);
    }
    if (!this.occupancy.has(key)) {
      batch.keys.add(key);
      this.occupancy.set(key, batch.id);
      return { status: "pinned" };
    }
    let queue = this.queues.get(key);
    if (queue === undefined) {
      queue = [];
      this.queues.set(key, queue);
    }
    if (queue.length >= this.maxWaitersPerKey) {
      throw new InvalidPinError(`waiter queue for key ${key} is full`);
    }
    const waiter: Waiter = {
      ticket: this.nextTicket++,
      batchId: batch.id,
      holderId,
      key,
      state: "waiting",
    };
    queue.push(waiter);
    this.tickets.set(waiter.ticket, waiter);
    return { status: "waiting", ticket: waiter.ticket };
  }

  seal(holderId: string, batchId: number, fence: number): boolean {
    const batch = this.mustGet(batchId);
    if (batch.fence !== fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (batch.holder !== holderId || batch.status !== "open") {
      return false;
    }
    if (this.hasPendingWaits(batch.id)) {
      throw new InvalidBatchError(
        `batch ${batchId} has unresolved waiting pins`,
      );
    }
    batch.status = "sealed";
    batch.deadline = this.clock.now() + this.leaseMs;
    return true;
  }

  commit(holderId: string, batchId: number, fence: number): boolean {
    const batch = this.mustGet(batchId);
    if (batch.fence !== fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (batch.holder !== holderId || batch.status !== "sealed") {
      return false;
    }
    this.releaseKeys(batch);
    batch.status = "committed";
    return true;
  }

  abort(holderId: string, batchId: number, fence: number): boolean {
    const batch = this.mustGet(batchId);
    if (batch.fence !== fence) {
      throw new FenceError(`fence mismatch for batch ${batchId}`);
    }
    if (batch.holder !== holderId) {
      return false;
    }
    if (batch.status !== "open" && batch.status !== "sealed") {
      return false;
    }
    this.teardown(batch, "aborted");
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const waiter = this.tickets.get(ticket);
    if (waiter === undefined) {
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
    const expired: Batch[] = [];
    for (const batch of this.batches.values()) {
      if (
        (batch.status === "open" || batch.status === "sealed") &&
        now >= batch.deadline
      ) {
        expired.push(batch);
      }
    }
    expired.sort((a, b) => a.id - b.id);
    for (const batch of expired) {
      this.teardown(batch, "timedout");
    }
    for (const key of [...this.queues.keys()]) {
      this.promote(key);
    }
    return { timedOut: expired.map((batch) => batch.id) };
  }

  statusOf(batchId: number): BatchStatus {
    return this.mustGet(batchId).status;
  }

  keysOf(batchId: number): string[] {
    return [...this.mustGet(batchId).keys].sort();
  }

  holderOfKey(key: string): string | undefined {
    const batchId = this.occupancy.get(key);
    if (batchId === undefined) {
      return undefined;
    }
    return this.batches.get(batchId)?.holder;
  }

  waitingTickets(key: string): number[] {
    return (this.queues.get(key) ?? []).map((waiter) => waiter.ticket);
  }

  private mustGet(batchId: number): Batch {
    const batch = this.batches.get(batchId);
    if (batch === undefined) {
      throw new UnknownBatchError(`unknown batch ${batchId}`);
    }
    return batch;
  }

  private hasPendingWaits(batchId: number): boolean {
    for (const queue of this.queues.values()) {
      for (const waiter of queue) {
        if (waiter.batchId === batchId && waiter.state === "waiting") {
          return true;
        }
      }
    }
    return false;
  }

  private cancelOwnWaiters(batchId: number): void {
    for (const queue of this.queues.values()) {
      for (const waiter of queue) {
        if (waiter.batchId === batchId && waiter.state === "waiting") {
          waiter.state = "cancelled";
        }
      }
    }
    for (const [key, queue] of this.queues) {
      const kept = queue.filter((waiter) => waiter.state === "waiting");
      if (kept.length === 0) {
        this.queues.delete(key);
      } else if (kept.length !== queue.length) {
        this.queues.set(key, kept);
      }
    }
  }

  private removeFromQueue(waiter: Waiter): void {
    const queue = this.queues.get(waiter.key);
    if (queue === undefined) {
      return;
    }
    const index = queue.indexOf(waiter);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.queues.delete(waiter.key);
    }
  }

  private releaseKeys(batch: Batch): void {
    const released = [...batch.keys];
    batch.keys.clear();
    for (const key of released) {
      if (this.occupancy.get(key) === batch.id) {
        this.occupancy.delete(key);
      }
    }
    for (const key of released) {
      this.promote(key);
    }
  }

  private teardown(batch: Batch, status: BatchStatus): void {
    this.cancelOwnWaiters(batch.id);
    this.releaseKeys(batch);
    batch.status = status;
  }

  private promote(key: string): void {
    if (this.occupancy.has(key)) {
      return;
    }
    const queue = this.queues.get(key);
    if (queue === undefined) {
      return;
    }
    while (queue.length > 0 && !this.occupancy.has(key)) {
      const waiter = queue[0];
      const batch = this.batches.get(waiter.batchId);
      if (
        batch !== undefined &&
        batch.status === "open" &&
        batch.keys.size < this.maxKeysPerBatch &&
        !batch.keys.has(key)
      ) {
        queue.shift();
        waiter.state = "settled";
        batch.keys.add(key);
        this.occupancy.set(key, batch.id);
      } else {
        queue.shift();
        waiter.state = "cancelled";
      }
    }
    if (queue.length === 0) {
      this.queues.delete(key);
    }
  }
}
