import { VirtualClock } from "./clock.js";
import {
  HandoffError,
  InvalidConfigError,
  UnknownOwnerError,
} from "./errors.js";
import { vnodeOf as hashVnodeOf } from "./hash.js";
import { HandoffBook } from "./handoff.js";
import { OwnerBook } from "./owners.js";
import { VNodeTable } from "./vnodes.js";
import type {
  HandoffView,
  OwnRouteOptions,
  ReadView,
  WriteResult,
} from "./types.js";

export class OwnRoute {
  readonly clock: VirtualClock;
  private readonly owners: OwnerBook;
  private readonly vnodes: VNodeTable;
  private readonly handoffs = new HandoffBook();
  private readonly vnodeCount: number;
  private readonly data = new Map<string, string>();

  constructor(opts: OwnRouteOptions) {
    if (!opts || !opts.clock) throw new InvalidConfigError("clock is required");
    if (!Array.isArray(opts.owners) || opts.owners.length === 0) {
      throw new InvalidConfigError("owners must be a non-empty array");
    }
    if (new Set(opts.owners).size !== opts.owners.length) {
      throw new InvalidConfigError("owners must be unique");
    }
    if (!Number.isInteger(opts.vnodeCount) || opts.vnodeCount < 1) {
      throw new InvalidConfigError("vnodeCount must be an integer >= 1");
    }
    this.clock = opts.clock;
    this.vnodeCount = opts.vnodeCount;
    this.owners = new OwnerBook(opts.owners);
    this.vnodes = new VNodeTable(opts.vnodeCount, this.owners.ids());
  }

  vnodeOf(key: string): number {
    return hashVnodeOf(key, this.vnodeCount);
  }

  ownerOf(key: string): string {
    return this.vnodes.ownerOf(this.vnodeOf(key));
  }

  epochOf(vnode: number): number {
    return this.vnodes.epochOf(vnode);
  }

  fenceOf(ownerId: string): number {
    return this.owners.fenceOf(ownerId);
  }

  write(
    ownerId: string,
    fence: number,
    key: string,
    value: string,
  ): WriteResult {
    const serving = this.ownerOf(key);
    if (ownerId !== serving) return "not_owner";
    if (fence !== this.owners.fenceOf(ownerId)) return "stale_fence";
    this.data.set(key, value);
    return "ok";
  }

  read(key: string): ReadView | undefined {
    const value = this.data.get(key);
    if (value === undefined) return undefined;
    const vnode = this.vnodeOf(key);
    return {
      value,
      ownerId: this.vnodes.ownerOf(vnode),
      epoch: this.vnodes.epochOf(vnode),
    };
  }

  propose(vnode: number, toOwnerId: string, ttlMs?: number | null): string {
    const from = this.vnodes.ownerOf(vnode);
    if (!this.owners.has(toOwnerId)) {
      throw new UnknownOwnerError(`unknown owner: ${toOwnerId}`);
    }
    if (toOwnerId === from) {
      throw new HandoffError(`owner ${toOwnerId} already owns vnode ${vnode}`);
    }
    const deadline =
      ttlMs === undefined || ttlMs === null
        ? null
        : this.clock.now() + ttlMs;
    return this.handoffs.propose(vnode, from, toOwnerId, deadline);
  }

  prepare(moveId: string): void {
    const record = this.handoffs.prepare(moveId);
    this.owners.bump(record.from);
  }

  commit(moveId: string): void {
    const { vnode, to } = this.handoffs.commit(moveId);
    this.vnodes.setOwner(vnode, to);
    this.vnodes.bumpEpoch(vnode);
    this.owners.bump(to);
  }

  abort(moveId: string): void {
    this.handoffs.abort(moveId);
  }

  drive(): string[] {
    const expired = this.handoffs.expired(this.clock.now());
    for (const moveId of expired) {
      this.handoffs.abort(moveId);
    }
    return expired;
  }

  handoffOf(vnode: number): HandoffView | undefined {
    this.vnodes.epochOf(vnode);
    return this.handoffs.view(vnode);
  }
}
