import {
  CapacityError,
  FenceError,
  InvalidArgError,
  InvalidConfigError,
  LeaseError,
  StateError,
  UnknownError,
} from "./errors.js";
import { hashKey } from "./hash.js";
import type {
  ClockLike,
  JournalEntry,
  LeaseInfo,
  Migration,
  PutResult,
  VnodeOwnOptions,
  VnodeOwnReplayOptions,
} from "./types.js";

function isPosInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

export class VnodeOwn {
  private readonly clock: ClockLike;
  private readonly leaseMs: number;
  private readonly vnodeCount: number;
  private readonly maxNodes: number;
  private readonly maxPending: number;
  private readonly maxKeys: number;

  private joinedNodes: string[] = [];
  private owners: (string | null)[];
  private readonly leases = new Map<string, LeaseInfo>();
  private readonly fences = new Map<string, number>();
  private readonly kv = new Map<string, unknown>();
  private readonly migrations = new Map<string, Migration>();
  private readonly log: JournalEntry[] = [];

  constructor(opts: VnodeOwnOptions) {
    if (!opts || typeof opts !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    const { clock, leaseMs, vnodeCount } = opts;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (!isPosInt(leaseMs)) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    if (!isPosInt(vnodeCount) || vnodeCount < 4) {
      throw new InvalidConfigError("vnodeCount must be an integer >= 4");
    }
    const maxNodes = opts.maxNodes ?? 8;
    const maxPending = opts.maxPending ?? 32;
    const maxKeys = opts.maxKeys ?? 64;
    if (!isPosInt(maxNodes)) {
      throw new InvalidConfigError("maxNodes must be an integer >= 1");
    }
    if (!isPosInt(maxPending)) {
      throw new InvalidConfigError("maxPending must be an integer >= 1");
    }
    if (!isPosInt(maxKeys)) {
      throw new InvalidConfigError("maxKeys must be an integer >= 1");
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.vnodeCount = vnodeCount;
    this.maxNodes = maxNodes;
    this.maxPending = maxPending;
    this.maxKeys = maxKeys;
    this.owners = new Array<string | null>(vnodeCount).fill(null);
  }

  static fromJournal(
    clock: ClockLike,
    opts: VnodeOwnReplayOptions,
    entries: readonly JournalEntry[],
  ): VnodeOwn {
    const v = new VnodeOwn({ ...opts, clock });
    for (const entry of entries) {
      v.replay(entry);
    }
    return v;
  }

  vnodeOf(key: string): number {
    this.checkKey(key);
    return hashKey(key) % this.vnodeCount;
  }

  ownerOf(key: string): string | null {
    return this.ownerOfVnode(this.vnodeOf(key));
  }

  ownerOfVnode(v: number): string | null {
    if (!Number.isInteger(v) || v < 0 || v >= this.vnodeCount) {
      throw new InvalidArgError("vnode index out of range");
    }
    return this.owners[v];
  }

  joined(): string[] {
    return [...this.joinedNodes];
  }

  pending(): Migration[] {
    return [...this.migrations.values()].map((m) => ({ ...m }));
  }

  leaseInfo(node: string): LeaseInfo | null {
    const lease = this.leases.get(node);
    if (!lease || lease.expireAt <= this.clock.now()) return null;
    return { fence: lease.fence, expireAt: lease.expireAt };
  }

  journal(): JournalEntry[] {
    return this.log.map((e) => ({ ...e }));
  }

  acquire(node: string): LeaseInfo {
    this.checkNode(node);
    const existing = this.leases.get(node);
    if (existing && existing.expireAt > this.clock.now()) {
      throw new StateError(`node "${node}" already holds a valid lease`);
    }
    const fence = (this.fences.get(node) ?? 0) + 1;
    const lease: LeaseInfo = { fence, expireAt: this.clock.now() + this.leaseMs };
    this.fences.set(node, fence);
    this.leases.set(node, lease);
    this.append({ seq: 0, type: "acquire", node, fence, expireAt: lease.expireAt });
    return { ...lease };
  }

  renew(node: string, fence: number): LeaseInfo {
    this.checkNode(node);
    const lease = this.validLease(node);
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for node "${node}"`);
    }
    lease.expireAt = this.clock.now() + this.leaseMs;
    this.append({ seq: 0, type: "renew", node, fence, expireAt: lease.expireAt });
    return { fence, expireAt: lease.expireAt };
  }

  release(node: string, fence: number): void {
    this.checkNode(node);
    const lease = this.validLease(node);
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for node "${node}"`);
    }
    if (this.joinedNodes.includes(node)) {
      throw new StateError(`node "${node}" must leave before release`);
    }
    this.leases.delete(node);
    this.append({ seq: 0, type: "release", node });
  }

  drive(): string[] {
    const now = this.clock.now();
    const expired: string[] = [];
    for (const [node, lease] of this.leases) {
      if (lease.expireAt <= now) expired.push(node);
    }
    expired.sort();
    if (expired.length === 0) return [];
    const gone = new Set(expired);
    const next = this.joinedNodes.filter((n) => !gone.has(n));
    this.applyMembership(next, false);
    for (const node of expired) {
      this.leases.delete(node);
    }
    this.append({ seq: 0, type: "expire", nodes: expired });
    return expired;
  }

  join(node: string): void {
    this.checkNode(node);
    this.validLease(node);
    if (this.joinedNodes.includes(node)) {
      throw new StateError(`node "${node}" is already joined`);
    }
    if (this.joinedNodes.length >= this.maxNodes) {
      throw new CapacityError("maxNodes reached");
    }
    this.applyMembership([...this.joinedNodes, node], false);
    this.append({ seq: 0, type: "join", node });
  }

  leave(node: string): void {
    this.checkNode(node);
    this.validLease(node);
    if (!this.joinedNodes.includes(node)) {
      throw new StateError(`node "${node}" is not joined`);
    }
    this.applyMembership(this.joinedNodes.filter((n) => n !== node), false);
    this.append({ seq: 0, type: "leave", node });
  }

  put(key: string, value: unknown): PutResult {
    this.checkKey(key);
    const owner = this.ownerOf(key);
    if (owner === null) {
      throw new StateError("no owner available for key");
    }
    if (!this.kv.has(key) && this.kv.size >= this.maxKeys) {
      throw new CapacityError("maxKeys reached");
    }
    this.kv.set(key, value);
    this.append({ seq: 0, type: "put", key, value });
    return { owner, migrating: this.migrations.has(key) };
  }

  get(key: string): unknown {
    this.checkKey(key);
    if (this.migrations.has(key)) {
      throw new StateError(`key "${key}" is migrating`);
    }
    return this.kv.get(key);
  }

  ackMigrate(key: string): void {
    this.checkKey(key);
    if (!this.migrations.delete(key)) {
      throw new UnknownError(`no pending migration for key "${key}"`);
    }
    this.append({ seq: 0, type: "ack", key });
  }

  drain(): string[] {
    const keys = [...this.migrations.keys()];
    if (keys.length === 0) return [];
    this.migrations.clear();
    this.append({ seq: 0, type: "drain" });
    return keys;
  }

  private append(entry: JournalEntry): void {
    entry.seq = this.log.length;
    this.log.push(entry);
  }

  private checkKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidArgError("key must be a non-empty string");
    }
  }

  private checkNode(node: string): void {
    if (typeof node !== "string" || node.length === 0) {
      throw new InvalidArgError("node must be a non-empty string");
    }
  }

  private validLease(node: string): LeaseInfo {
    const lease = this.leases.get(node);
    if (!lease || lease.expireAt <= this.clock.now()) {
      throw new LeaseError(`node "${node}" holds no valid lease`);
    }
    return lease;
  }

  private computeOwners(members: string[]): (string | null)[] {
    const sorted = [...members].sort();
    const owners = new Array<string | null>(this.vnodeCount).fill(null);
    if (sorted.length > 0) {
      for (let v = 0; v < this.vnodeCount; v++) {
        owners[v] = sorted[v % sorted.length];
      }
    }
    return owners;
  }

  private applyMembership(next: string[], replay: boolean): void {
    const nextOwners = this.computeOwners(next);
    const moved = new Set<number>();
    for (let v = 0; v < this.vnodeCount; v++) {
      if (this.owners[v] !== nextOwners[v]) moved.add(v);
    }
    const merged = new Map(this.migrations);
    for (const key of this.kv.keys()) {
      const vnode = hashKey(key) % this.vnodeCount;
      if (
        moved.has(vnode) &&
        this.owners[vnode] !== null &&
        nextOwners[vnode] !== null
      ) {
        merged.set(key, {
          key,
          from: this.owners[vnode] as string,
          to: nextOwners[vnode] as string,
        });
      }
    }
    if (!replay && merged.size > this.maxPending) {
      throw new CapacityError("maxPending would be exceeded");
    }
    this.joinedNodes = next;
    this.owners = nextOwners;
    this.migrations.clear();
    for (const [k, m] of merged) this.migrations.set(k, m);
  }

  private replay(entry: JournalEntry): void {
    switch (entry.type) {
      case "acquire":
        this.fences.set(entry.node, entry.fence);
        this.leases.set(entry.node, { fence: entry.fence, expireAt: entry.expireAt });
        break;
      case "renew":
        this.leases.set(entry.node, { fence: entry.fence, expireAt: entry.expireAt });
        break;
      case "release":
        this.leases.delete(entry.node);
        break;
      case "join":
        this.applyMembership([...this.joinedNodes, entry.node], true);
        break;
      case "leave":
        this.applyMembership(
          this.joinedNodes.filter((n) => n !== entry.node),
          true,
        );
        break;
      case "expire": {
        const gone = new Set(entry.nodes);
        this.applyMembership(
          this.joinedNodes.filter((n) => !gone.has(n)),
          true,
        );
        for (const node of entry.nodes) this.leases.delete(node);
        break;
      }
      case "put":
        this.kv.set(entry.key, entry.value);
        break;
      case "ack":
        this.migrations.delete(entry.key);
        break;
      case "drain":
        this.migrations.clear();
        break;
    }
    this.log.push({ ...entry, seq: this.log.length });
  }
}
