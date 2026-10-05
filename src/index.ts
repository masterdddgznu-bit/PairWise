export class StealQError extends Error {}
export class InvalidConfigError extends StealQError {}
export class InvalidArgError extends StealQError {}
export class UnknownItemError extends StealQError {}
export class FenceError extends StealQError {}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new InvalidArgError("advance requires a non-negative number");
    }
    this.t += ms;
  }
}

export interface StealQOptions {
  clock: VirtualClock;
  stealAfterMs: number;
  leaseMs: number;
  maxInflight?: number;
}

export interface LeaseResult {
  itemId: number;
  fence: number;
  owner: string;
  payload: unknown;
}

type ItemStatus = "queued" | "leased" | "done";

interface Item {
  id: number;
  owner: string;
  payload: unknown;
  status: ItemStatus;
  enqueuedAt: number;
  fence: number;
  leasedBy: string | null;
  deadline: number;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

export class StealQ {
  private readonly clock: VirtualClock;
  private readonly stealAfterMs: number;
  private readonly leaseMs: number;
  private readonly maxInflight: number;

  private nextItemId = 1;
  private nextFence = 1;
  private readonly items = new Map<number, Item>();
  private readonly queues = new Map<string, number[]>();
  private readonly idleSince = new Map<string, number>();
  private readonly inflight = new Map<string, Set<number>>();

  constructor(opts: StealQOptions) {
    if (!opts || typeof opts !== "object" || !opts.clock) {
      throw new InvalidConfigError("clock is required");
    }
    if (!isPositiveInt(opts.stealAfterMs)) {
      throw new InvalidConfigError("stealAfterMs must be an integer >= 1");
    }
    if (!isPositiveInt(opts.leaseMs)) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    const maxInflight = opts.maxInflight ?? 8;
    if (!isPositiveInt(maxInflight)) {
      throw new InvalidConfigError("maxInflight must be an integer >= 1");
    }
    this.clock = opts.clock;
    this.stealAfterMs = opts.stealAfterMs;
    this.leaseMs = opts.leaseMs;
    this.maxInflight = maxInflight;
  }

  enqueue(owner: string, payload: unknown): { itemId: number } {
    this.requireName(owner, "owner");
    const id = this.nextItemId++;
    const item: Item = {
      id,
      owner,
      payload,
      status: "queued",
      enqueuedAt: this.clock.now(),
      fence: 0,
      leasedBy: null,
      deadline: 0,
    };
    this.items.set(id, item);
    this.queueOf(owner).push(id);
    this.idleSince.delete(owner);
    return { itemId: id };
  }

  lease(worker: string): LeaseResult | null {
    this.requireName(worker, "worker");
    if (this.inflightCount(worker) >= this.maxInflight) {
      return null;
    }
    const now = this.clock.now();
    const own = this.queues.get(worker);
    if (own !== undefined && own.length > 0) {
      const id = own.shift()!;
      return this.grant(id, worker, now);
    }
    const idle = this.idleSince.get(worker);
    if (idle === undefined) {
      this.idleSince.set(worker, now);
      return null;
    }
    if (now < idle + this.stealAfterMs) {
      return null;
    }
    let best: Item | null = null;
    for (const [owner, queue] of this.queues) {
      if (owner === worker || queue.length === 0) continue;
      const head = this.items.get(queue[0])!;
      if (
        best === null ||
        head.enqueuedAt < best.enqueuedAt ||
        (head.enqueuedAt === best.enqueuedAt && head.id < best.id)
      ) {
        best = head;
      }
    }
    if (best === null) {
      return null;
    }
    this.queues.get(best.owner)!.shift();
    return this.grant(best.id, worker, now);
  }

  ack(worker: string, itemId: number, fence: number): boolean {
    const item = this.checked(itemId, fence);
    if (item.status !== "leased" || item.leasedBy !== worker) {
      return false;
    }
    item.status = "done";
    item.leasedBy = null;
    this.releaseInflight(worker, item.id);
    return true;
  }

  nack(worker: string, itemId: number, fence: number): boolean {
    const item = this.checked(itemId, fence);
    if (item.status !== "leased" || item.leasedBy !== worker) {
      return false;
    }
    this.requeue(item);
    return true;
  }

  drive(): { expired: number[] } {
    const now = this.clock.now();
    const expired: number[] = [];
    for (const item of this.items.values()) {
      if (item.status === "leased" && now >= item.deadline) {
        expired.push(item.id);
      }
    }
    expired.sort((a, b) => a - b);
    for (const id of expired) {
      this.requeue(this.items.get(id)!);
    }
    return { expired };
  }

  queuedIds(owner: string): number[] {
    return [...(this.queues.get(owner) ?? [])];
  }

  inflightIds(worker: string): number[] {
    return [...(this.inflight.get(worker) ?? [])].sort((a, b) => a - b);
  }

  ownerOf(itemId: number): string {
    return this.item(itemId).owner;
  }

  statusOf(itemId: number): ItemStatus {
    return this.item(itemId).status;
  }

  private grant(id: number, worker: string, now: number): LeaseResult {
    const item = this.items.get(id)!;
    item.status = "leased";
    item.fence = this.nextFence++;
    item.leasedBy = worker;
    item.deadline = now + this.leaseMs;
    let set = this.inflight.get(worker);
    if (set === undefined) {
      set = new Set();
      this.inflight.set(worker, set);
    }
    set.add(id);
    return {
      itemId: item.id,
      fence: item.fence,
      owner: item.owner,
      payload: item.payload,
    };
  }

  private requeue(item: Item): void {
    const worker = item.leasedBy!;
    item.status = "queued";
    item.leasedBy = null;
    item.enqueuedAt = this.clock.now();
    this.releaseInflight(worker, item.id);
    this.queueOf(item.owner).push(item.id);
  }

  private releaseInflight(worker: string, id: number): void {
    const set = this.inflight.get(worker);
    if (set !== undefined) {
      set.delete(id);
      if (set.size === 0) {
        this.inflight.delete(worker);
      }
    }
  }

  private inflightCount(worker: string): number {
    return this.inflight.get(worker)?.size ?? 0;
  }

  private queueOf(owner: string): number[] {
    let queue = this.queues.get(owner);
    if (queue === undefined) {
      queue = [];
      this.queues.set(owner, queue);
    }
    return queue;
  }

  private item(itemId: number): Item {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new UnknownItemError(`unknown item: ${itemId}`);
    }
    return item;
  }

  private checked(itemId: number, fence: number): Item {
    const item = this.item(itemId);
    if (item.fence !== fence) {
      throw new FenceError(`fence mismatch for item ${itemId}`);
    }
    return item;
  }

  private requireName(value: string, what: string): void {
    if (typeof value !== "string" || value.length === 0) {
      throw new InvalidArgError(`${what} must be a non-empty string`);
    }
  }
}
