import { VirtualClock } from "./clock.js";
import {
  HandoffError,
  InvalidConfigError,
  UnknownOwnerError,
} from "./errors.js";
import { vnodeOf } from "./hash.js";
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
  private readonly handoffs: HandoffBook;

  constructor(opts: OwnRouteOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
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
    this.owners = new OwnerBook(opts.owners);
    this.vnodes = new VNodeTable(opts.vnodeCount, this.owners.ids());
    this.handoffs = new HandoffBook();
  }

  vnodeOf(key: string): number {
    return vnodeOf(key, this.vnodes.count);
  }

  ownerOf(key: string): string {
    const vnode = this.vnodeOf(key);
    const active = this.handoffs.view(vnode);
    if (active !== undefined) return active.from;
    return this.vnodes.ownerOf(vnode);
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
    const vnode = this.vnodeOf(key);
    const serving = this.ownerOf(key);
    if (ownerId !== serving) return "not_owner";
    if (fence !== this.owners.fenceOf(ownerId)) return "stale_fence";
    this.vnodes.set(vnode, key, value);
    return "ok";
  }

  read(key: string): ReadView | undefined {
    const vnode = this.vnodeOf(key);
    const value = this.vnodes.get(vnode, key);
    if (value === undefined) return undefined;
    return {
      value,
      ownerId: this.ownerOf(key),
      epoch: this.vnodes.epochOf(vnode),
    };
  }

  propose(vnode: number, toOwnerId: string, ttlMs?: number | null): string {
    const from = this.vnodes.ownerOf(vnode);
    if (!this.owners.has(toOwnerId)) {
      throw new UnknownOwnerError(`unknown owner: ${toOwnerId}`);
    }
    if (toOwnerId === from) {
      throw new HandoffError(`vnode ${vnode} already owned by ${toOwnerId}`);
    }
    const deadline =
      ttlMs === undefined || ttlMs === null
        ? null
        : this.clock.now() + ttlMs;
    return this.handoffs.propose(vnode, from, toOwnerId, deadline);
  }

  prepare(moveId: string): void {
    this.handoffs.prepare(moveId);
    const record = this.handoffs.get(moveId)!;
    this.owners.bump(record.from);
  }

  commit(moveId: string): void {
    const done = this.handoffs.commit(moveId);
    this.vnodes.setOwner(done.vnode, done.to);
    this.vnodes.bumpEpoch(done.vnode);
    this.owners.bump(done.to);
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
    this.vnodes.ownerOf(vnode);
    return this.handoffs.view(vnode);
  }
}
