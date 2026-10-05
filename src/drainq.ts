import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidEnqueueError,
  InvalidLeaseError,
  UnknownItemError,
} from "./errors.js";

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
  consumerId: string | null;
  deadline: number;
}

export class DrainQ {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxInflight: number;
  private readonly maxQuarantine: number;

  private activeGen = 1;
  private modeValue: Mode = "running";
  private nextItemId = 1;
  private nextFence = 1;
  private readonly items = new Map<number, Item>();

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
        `generation ${opts.generation} is not writable; expected ${writeGen}`,
      );
    }
    const itemId = this.nextItemId++;
    this.items.set(itemId, {
      itemId,
      generation: writeGen,
      payload,
      status: "queued",
      fence: 0,
      consumerId: null,
      deadline: 0,
    });
    return { itemId, generation: writeGen };
  }

  lease(consumerId: string): LeaseResult | null {
    if (typeof consumerId !== "string" || consumerId.length === 0) {
      throw new InvalidLeaseError("consumerId must be a non-empty string");
    }
    if (this.inflightCount() >= this.maxInflight) {
      return null;
    }
    let candidate: Item | null = null;
    for (const item of this.items.values()) {
      if (item.status === "queued" && item.generation === this.activeGen) {
        if (candidate === null || item.itemId < candidate.itemId) {
          candidate = item;
        }
      }
    }
    if (candidate === null) {
      return null;
    }
    candidate.status = "leased";
    candidate.fence = this.nextFence++;
    candidate.consumerId = consumerId;
    candidate.deadline = this.clock.now() + this.leaseMs;
    return {
      itemId: candidate.itemId,
      fence: candidate.fence,
      generation: candidate.generation,
      payload: candidate.payload,
    };
  }

  ack(consumerId: string, itemId: number, fence: number): boolean {
    const item = this.leasedBy(itemId, fence);
    if (item.consumerId !== consumerId) {
      return false;
    }
    item.status = "done";
    item.consumerId = null;
    return true;
  }

  nack(
    consumerId: string,
    itemId: number,
    fence: number,
    opts?: { quarantine?: boolean },
  ): boolean {
    const item = this.leasedBy(itemId, fence);
    if (item.consumerId !== consumerId) {
      return false;
    }
    if (opts?.quarantine === true) {
      if (this.quarantineCount() >= this.maxQuarantine) {
        throw new InvalidLeaseError("quarantine is full");
      }
      item.status = "quarantined";
    } else {
      item.status = "queued";
    }
    item.consumerId = null;
    return true;
  }

  beginDrain(): number {
    if (this.modeValue === "draining") {
      throw new InvalidEnqueueError("already draining");
    }
    this.modeValue = "draining";
    return this.activeGen + 1;
  }

  finishDrain(): boolean {
    if (this.modeValue !== "draining") {
      return false;
    }
    for (const item of this.items.values()) {
      if (
        item.generation === this.activeGen &&
        (item.status === "queued" || item.status === "leased")
      ) {
        return false;
      }
    }
    this.activeGen += 1;
    this.modeValue = "running";
    return true;
  }

  requeueQuarantine(itemId: number): boolean {
    const item = this.getItem(itemId);
    if (item.status !== "quarantined") {
      return false;
    }
    if (item.generation < this.activeGen) {
      throw new InvalidEnqueueError(
        `generation ${item.generation} is no longer active`,
      );
    }
    item.status = "queued";
    return true;
  }

  drive(): { expired: number[] } {
    const now = this.clock.now();
    const expired: number[] = [];
    for (const item of this.items.values()) {
      if (item.status === "leased" && now >= item.deadline) {
        item.status = "queued";
        item.consumerId = null;
        expired.push(item.itemId);
      }
    }
    expired.sort((a, b) => a - b);
    return { expired };
  }

  statusOf(itemId: number): ItemStatus {
    return this.getItem(itemId).status;
  }

  activeGeneration(): number {
    return this.activeGen;
  }

  writeGeneration(): number {
    return this.modeValue === "running" ? this.activeGen : this.activeGen + 1;
  }

  mode(): Mode {
    return this.modeValue;
  }

  queuedIds(generation?: number): number[] {
    const gen = generation ?? this.activeGen;
    return this.sortedIds(
      (item) => item.status === "queued" && item.generation === gen,
    );
  }

  inflightIds(): number[] {
    return this.sortedIds((item) => item.status === "leased");
  }

  quarantineIds(): number[] {
    return this.sortedIds((item) => item.status === "quarantined");
  }

  private getItem(itemId: number): Item {
    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    return item;
  }

  private leasedBy(itemId: number, fence: number): Item {
    const item = this.getItem(itemId);
    if (item.status !== "leased" || item.fence !== fence) {
      throw new FenceError(`fence mismatch for item ${itemId}`);
    }
    return item;
  }

  private inflightCount(): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.status === "leased") {
        count += 1;
      }
    }
    return count;
  }

  private quarantineCount(): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.status === "quarantined") {
        count += 1;
      }
    }
    return count;
  }

  private sortedIds(pred: (item: Item) => boolean): number[] {
    const ids: number[] = [];
    for (const item of this.items.values()) {
      if (pred(item)) {
        ids.push(item.itemId);
      }
    }
    ids.sort((a, b) => a - b);
    return ids;
  }
}
