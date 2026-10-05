export class StealQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

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

export interface StealQConfig {
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
  itemId: number;
  owner: string;
  payload: unknown;
  status: ItemStatus;
  enqueuedAt: number;
  leasedBy: string | null;
  fence: number;
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
  private readonly inflight = new Map<string, Set<number>>();
  private readonly idleSince = new Map<string, number>();

  constructor(config: StealQConfig) {
    if (
      config == null ||
      typeof config !== "object" ||
      !(config.clock instanceof VirtualClock) ||
      !isPositiveInt(config.stealAfterMs) ||
      !isPositiveInt(config.leaseMs) ||
      (config.maxInflight !== undefined && !isPositiveInt(config.maxInflight))
    ) {
      throw new InvalidConfigError("invalid StealQ configuration");
    }
    this.clock = config.clock;
    this.stealAfterMs = config.stealAfterMs;
    this.leaseMs = config.leaseMs;
    this.maxInflight = config.maxInflight ?? 8;
  }

  enqueue(owner: string, payload: unknown): { itemId: number } {
    if (typeof owner !== "string" || owner.length === 0) {
      throw new InvalidArgError("owner must be a non-empty string");
    }
    const itemId = this.nextItemId++;
    const item: Item = {
      itemId,
      owner,
      payload,
      status: "queued",
      enqueuedAt: this.clock.now(),
      leasedBy: null,
      fence: 0,
      deadline: 0,
    };
    this.items.set(itemId, item);
    this.queueOf(owner).push(itemId);
    this.idleSince.delete(owner);
    return { itemId };
  }

  lease(worker: string): LeaseResult | null {
    if (typeof worker !== "string" || worker.length === 0) {
      throw new InvalidArgError("worker must be a non-empty string");
    }
    if (this.inflightOf(worker).size >= this.maxInflight) {
      return null;
    }
    const now = this.clock.now();
    const own = this.queueOf(worker);
    let item: Item | null = null;

    if (own.length > 0) {
      item = this.items.get(own.shift()!)!;
    } else {
      const idleStart = this.idleSince.get(worker);
      if (idleStart === undefined) {
        this.idleSince.set(worker, now);
        return null;
      }
      if (now < idleStart + this.stealAfterMs) {
        return null;
      }
      item = this.oldestStealable(worker);
      if (item === null) {
        return null;
      }
      const ownerQueue = this.queueOf(item.owner);
      ownerQueue.splice(ownerQueue.indexOf(item.itemId), 1);
    }

    item.status = "leased";
    item.leasedBy = worker;
    item.fence = this.nextFence++;
    item.deadline = now + this.leaseMs;
    this.inflightOf(worker).add(item.itemId);
    return {
      itemId: item.itemId,
      fence: item.fence,
      owner: item.owner,
      payload: item.payload,
    };
  }

  ack(worker: string, itemId: number, fence: number): boolean {
    const item = this.checkedItem(itemId, fence);
    if (item.status !== "leased" || item.leasedBy !== worker) {
      return false;
    }
    item.status = "done";
    item.leasedBy = null;
    this.inflightOf(worker).delete(itemId);
    return true;
  }

  nack(worker: string, itemId: number, fence: number): boolean {
    const item = this.checkedItem(itemId, fence);
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
        expired.push(item.itemId);
      }
    }
    expired.sort((a, b) => a - b);
    for (const itemId of expired) {
      this.requeue(this.items.get(itemId)!);
    }
    return { expired };
  }

  queuedIds(owner: string): number[] {
    return [...this.queueOf(owner)];
  }

  inflightIds(worker: string): number[] {
    return [...this.inflightOf(worker)].sort((a, b) => a - b);
  }

  ownerOf(itemId: number): string {
    return this.mustGet(itemId).owner;
  }

  statusOf(itemId: number): ItemStatus {
    return this.mustGet(itemId).status;
  }

  private queueOf(owner: string): number[] {
    let q = this.queues.get(owner);
    if (q === undefined) {
      q = [];
      this.queues.set(owner, q);
    }
    return q;
  }

  private inflightOf(worker: string): Set<number> {
    let s = this.inflight.get(worker);
    if (s === undefined) {
      s = new Set();
      this.inflight.set(worker, s);
    }
    return s;
  }

  private oldestStealable(worker: string): Item | null {
    let best: Item | null = null;
    for (const [owner, queue] of this.queues) {
      if (owner === worker) continue;
      for (const itemId of queue) {
        const item = this.items.get(itemId)!;
        if (
          best === null ||
          item.enqueuedAt < best.enqueuedAt ||
          (item.enqueuedAt === best.enqueuedAt && item.itemId < best.itemId)
        ) {
          best = item;
        }
      }
    }
    return best;
  }

  private requeue(item: Item): void {
    const worker = item.leasedBy!;
    this.inflightOf(worker).delete(item.itemId);
    item.status = "queued";
    item.leasedBy = null;
    item.enqueuedAt = this.clock.now();
    this.queueOf(item.owner).push(item.itemId);
    this.idleSince.delete(item.owner);
  }

  private mustGet(itemId: number): Item {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new UnknownItemError(`unknown item: ${itemId}`);
    }
    return item;
  }

  private checkedItem(itemId: number, fence: number): Item {
    const item = this.mustGet(itemId);
    if (item.fence !== fence) {
      throw new FenceError(`fence mismatch for item ${itemId}`);
    }
    return item;
  }
}
