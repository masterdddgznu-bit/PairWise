export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error("cannot advance clock by a negative amount");
    }
    this.t += ms;
  }
}

export class DrainQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DrainQError {}
export class InvalidEnqueueError extends DrainQError {}
export class InvalidLeaseError extends DrainQError {}
export class UnknownItemError extends DrainQError {}
export class FenceError extends DrainQError {}

export type ItemStatus = "queued" | "leased" | "done" | "quarantined";
export type Mode = "running" | "draining";

export interface DrainQOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxInflight?: number;
  maxQuarantine?: number;
}

export interface EnqueueResult {
  itemId: number;
  generation: number;
}

export interface LeaseResult {
  itemId: number;
  fence: number;
  generation: number;
  payload: unknown;
}

interface Item {
  itemId: number;
  generation: number;
  payload: unknown;
  status: ItemStatus;
  fence: number;
  deadline: number;
  consumerId: string | null;
}

export class DrainQ {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxInflight: number;
  private readonly maxQuarantine: number;

  private mode_: Mode = "running";
  private activeGen = 1;
  private nextItemId = 1;
  private nextFence = 1;

  private readonly items = new Map<number, Item>();
  private readonly queuedByGen = new Map<number, number[]>();
  private readonly inflight = new Set<number>();
  private readonly quarantined = new Set<number>();

  constructor(opts: DrainQOptions) {
    const maxInflight = opts.maxInflight ?? 8;
    const maxQuarantine = opts.maxQuarantine ?? 8;
    if (!Number.isInteger(opts.leaseMs) || opts.leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxInflight) || maxInflight < 1) {
      throw new InvalidConfigError("maxInflight must be an integer >= 1");
    }
    if (!Number.isInteger(maxQuarantine) || maxQuarantine < 1) {
      throw new InvalidConfigError("maxQuarantine must be an integer >= 1");
    }
    this.clock = opts.clock;
    this.leaseMs = opts.leaseMs;
    this.maxInflight = maxInflight;
    this.maxQuarantine = maxQuarantine;
  }

  enqueue(payload: unknown, opts?: { generation?: number }): EnqueueResult {
    const writeGen = this.writeGeneration();
    if (opts?.generation !== undefined && opts.generation !== writeGen) {
      throw new InvalidEnqueueError(
        `generation ${opts.generation} is not writable; write generation is ${writeGen}`,
      );
    }
    const itemId = this.nextItemId++;
    const item: Item = {
      itemId,
      generation: writeGen,
      payload,
      status: "queued",
      fence: 0,
      deadline: 0,
      consumerId: null,
    };
    this.items.set(itemId, item);
    this.insertQueued(writeGen, itemId);
    return { itemId, generation: writeGen };
  }

  lease(consumerId: string): LeaseResult | null {
    if (typeof consumerId !== "string" || consumerId.length === 0) {
      throw new InvalidLeaseError("consumerId must be a non-empty string");
    }
    if (this.inflight.size >= this.maxInflight) {
      return null;
    }
    const queue = this.queuedByGen.get(this.activeGen);
    if (!queue || queue.length === 0) {
      return null;
    }
    const itemId = queue.shift()!;
    const item = this.items.get(itemId)!;
    const fence = this.nextFence++;
    item.status = "leased";
    item.fence = fence;
    item.deadline = this.clock.now() + this.leaseMs;
    item.consumerId = consumerId;
    this.inflight.add(itemId);
    return {
      itemId,
      fence,
      generation: item.generation,
      payload: item.payload,
    };
  }

  ack(consumerId: string, itemId: number, fence: number): boolean {
    const item = this.checkedItem(itemId, fence);
    if (item.status !== "leased" || item.consumerId !== consumerId) {
      return false;
    }
    item.status = "done";
    item.consumerId = null;
    item.fence = 0;
    this.inflight.delete(itemId);
    return true;
  }

  nack(
    consumerId: string,
    itemId: number,
    fence: number,
    opts?: { quarantine?: boolean },
  ): boolean {
    const item = this.checkedItem(itemId, fence);
    if (item.status !== "leased" || item.consumerId !== consumerId) {
      return false;
    }
    if (opts?.quarantine === true) {
      if (this.quarantined.size >= this.maxQuarantine) {
        throw new InvalidLeaseError("quarantine is full");
      }
      item.status = "quarantined";
      item.consumerId = null;
      item.fence = 0;
      this.inflight.delete(itemId);
      this.quarantined.add(itemId);
      return true;
    }
    this.requeue(item);
    return true;
  }

  beginDrain(): number {
    if (this.mode_ === "draining") {
      throw new InvalidEnqueueError("already draining");
    }
    this.mode_ = "draining";
    return this.activeGen + 1;
  }

  finishDrain(): boolean {
    if (this.mode_ !== "draining") {
      return false;
    }
    const queue = this.queuedByGen.get(this.activeGen);
    if ((queue && queue.length > 0) || this.hasInflightIn(this.activeGen)) {
      return false;
    }
    this.activeGen += 1;
    this.mode_ = "running";
    return true;
  }

  requeueQuarantine(itemId: number): boolean {
    const item = this.items.get(itemId);
    if (!item) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    if (item.status !== "quarantined") {
      return false;
    }
    if (item.generation < this.activeGen) {
      throw new InvalidEnqueueError(
        `generation ${item.generation} is no longer writable`,
      );
    }
    this.quarantined.delete(itemId);
    item.status = "queued";
    this.insertQueued(item.generation, itemId);
    return true;
  }

  drive(): { expired: number[] } {
    const now = this.clock.now();
    const expired: number[] = [];
    for (const itemId of this.inflight) {
      const item = this.items.get(itemId)!;
      if (item.status === "leased" && now >= item.deadline) {
        expired.push(itemId);
      }
    }
    expired.sort((a, b) => a - b);
    for (const itemId of expired) {
      this.requeue(this.items.get(itemId)!);
    }
    return { expired };
  }

  statusOf(itemId: number): ItemStatus {
    const item = this.items.get(itemId);
    if (!item) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    return item.status;
  }

  activeGeneration(): number {
    return this.activeGen;
  }

  writeGeneration(): number {
    return this.mode_ === "running" ? this.activeGen : this.activeGen + 1;
  }

  mode(): Mode {
    return this.mode_;
  }

  queuedIds(generation?: number): number[] {
    const gen = generation ?? this.activeGen;
    return [...(this.queuedByGen.get(gen) ?? [])];
  }

  inflightIds(): number[] {
    return [...this.inflight].sort((a, b) => a - b);
  }

  quarantineIds(): number[] {
    return [...this.quarantined].sort((a, b) => a - b);
  }

  private checkedItem(itemId: number, fence: number): Item {
    const item = this.items.get(itemId);
    if (!item) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    if (item.fence !== fence) {
      throw new FenceError(`fence mismatch for item ${itemId}`);
    }
    return item;
  }

  private requeue(item: Item): void {
    item.status = "queued";
    item.consumerId = null;
    item.fence = 0;
    this.inflight.delete(item.itemId);
    this.insertQueued(item.generation, item.itemId);
  }

  private insertQueued(generation: number, itemId: number): void {
    let queue = this.queuedByGen.get(generation);
    if (!queue) {
      queue = [];
      this.queuedByGen.set(generation, queue);
    }
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (queue[mid] < itemId) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    queue.splice(lo, 0, itemId);
  }

  private hasInflightIn(generation: number): boolean {
    for (const itemId of this.inflight) {
      if (this.items.get(itemId)!.generation === generation) {
        return true;
      }
    }
    return false;
  }
}
