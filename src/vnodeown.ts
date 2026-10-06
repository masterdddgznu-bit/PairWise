import { VirtualClock } from "./clock.js";
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

export interface LeaseInfo {
  fence: number;
  expireAt: number;
}

export interface PendingRec {
  key: string;
  from: string | null;
  to: string;
}

export interface PutResult {
  owner: string;
  migrating: boolean;
}

export type JournalEntry =
  | { op: "acquire"; node: string; fence: number; expireAt: number }
  | { op: "renew"; node: string; fence: number; expireAt: number }
  | { op: "release"; node: string }
  | { op: "join"; node: string }
  | { op: "leave"; node: string }
  | { op: "expire"; node: string }
  | { op: "put"; key: string; value: unknown }
  | { op: "ack"; key: string }
  | { op: "drain"; keys: string[] };

export interface VnodeOwnOptions {
  clock: VirtualClock;
  leaseMs: number;
  vnodeCount: number;
  maxNodes?: number;
  maxPending?: number;
  maxKeys?: number;
}

export interface VnodeOwnBaseOptions {
  leaseMs: number;
  vnodeCount: number;
  maxNodes?: number;
  maxPending?: number;
  maxKeys?: number;
}

interface Plan {
  owners: (string | null)[];
  pending: Map<string, PendingRec>;
}

function isPosInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

function cloneEntry(e: JournalEntry): JournalEntry {
  if (e.op === "drain") return { op: "drain", keys: [...e.keys] };
  return { ...e };
}

export class VnodeOwn {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly vnodeCount: number;
  private readonly maxNodes: number;
  private readonly maxPending: number;
  private readonly maxKeys: number;

  private readonly leases = new Map<string, LeaseInfo>();
  private readonly lastFence = new Map<string, number>();
  private joinedArr: string[] = [];
  private owners: (string | null)[];
  private readonly kv = new Map<string, unknown>();
  private migrations = new Map<string, PendingRec>();
  private readonly log: JournalEntry[] = [];

  constructor(opts: VnodeOwnOptions) {
    if (!opts || typeof opts !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    const { clock, leaseMs, vnodeCount } = opts;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
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
    clock: VirtualClock,
    opts: VnodeOwnBaseOptions,
    entries: readonly JournalEntry[],
  ): VnodeOwn {
    const v = new VnodeOwn({ ...opts, clock });
    for (const raw of entries) {
      const entry = cloneEntry(raw);
      v.apply(entry);
      v.log.push(entry);
    }
    return v;
  }

  // ---- lease ----

  acquire(node: string): LeaseInfo {
    this.checkNode(node);
    if (this.validLease(node)) {
      throw new StateError(`node ${node} already holds a valid lease`);
    }
    const fence = (this.lastFence.get(node) ?? 0) + 1;
    const expireAt = this.clock.now() + this.leaseMs;
    this.leases.set(node, { fence, expireAt });
    this.lastFence.set(node, fence);
    this.log.push({ op: "acquire", node, fence, expireAt });
    return { fence, expireAt };
  }

  renew(node: string, fence: number): LeaseInfo {
    this.checkNode(node);
    const lease = this.validLease(node);
    if (!lease) throw new LeaseError(`no valid lease for ${node}`);
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for ${node}`);
    }
    lease.expireAt = this.clock.now() + this.leaseMs;
    this.log.push({ op: "renew", node, fence, expireAt: lease.expireAt });
    return { fence, expireAt: lease.expireAt };
  }

  release(node: string, fence: number): void {
    this.checkNode(node);
    const lease = this.validLease(node);
    if (!lease) throw new LeaseError(`no valid lease for ${node}`);
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for ${node}`);
    }
    if (this.joinedArr.includes(node)) {
      throw new StateError(`node ${node} is still joined`);
    }
    this.leases.delete(node);
    this.log.push({ op: "release", node });
  }

  drive(): string[] {
    const now = this.clock.now();
    const expired: string[] = [];
    for (const [node, lease] of this.leases) {
      if (lease.expireAt <= now) expired.push(node);
    }
    if (expired.length === 0) return [];
    const snapJoined = [...this.joinedArr];
    const snapOwners = [...this.owners];
    const snapPending = this.copyPending();
    const snapLeases = new Map(
      [...this.leases].map(([n, l]) => [n, { ...l }]),
    );
    for (const node of expired) {
      this.leases.delete(node);
      if (this.joinedArr.includes(node)) {
        this.commitLeave(node, this.planLeave(node));
      }
    }
    if (this.migrations.size > this.maxPending) {
      this.joinedArr = snapJoined;
      this.owners = snapOwners;
      this.migrations = snapPending;
      this.leases.clear();
      for (const [n, l] of snapLeases) this.leases.set(n, l);
      throw new CapacityError("maxPending would be exceeded");
    }
    for (const node of expired) this.log.push({ op: "expire", node });
    return expired;
  }

  // ---- membership ----

  join(node: string): void {
    this.checkNode(node);
    if (!this.validLease(node)) {
      throw new LeaseError(`no valid lease for ${node}`);
    }
    if (this.joinedArr.includes(node)) {
      throw new StateError(`node ${node} is already joined`);
    }
    if (this.joinedArr.length >= this.maxNodes) {
      throw new CapacityError("maxNodes reached");
    }
    const plan = this.planMembership([...this.joinedArr, node]);
    if (plan.pending.size > this.maxPending) {
      throw new CapacityError("maxPending would be exceeded");
    }
    this.joinedArr.push(node);
    this.owners = plan.owners;
    this.migrations = plan.pending;
    this.log.push({ op: "join", node });
  }

  leave(node: string): void {
    this.checkNode(node);
    if (!this.validLease(node)) {
      throw new LeaseError(`no valid lease for ${node}`);
    }
    if (!this.joinedArr.includes(node)) {
      throw new StateError(`node ${node} is not joined`);
    }
    const plan = this.planLeave(node);
    if (plan.pending.size > this.maxPending) {
      throw new CapacityError("maxPending would be exceeded");
    }
    this.commitLeave(node, plan);
    this.log.push({ op: "leave", node });
  }

  // ---- kv ----

  put(key: string, value: unknown): PutResult {
    this.checkKey(key);
    const owner = this.owners[hashKey(key) % this.vnodeCount] ?? null;
    if (owner === null) throw new StateError("no owner for key");
    if (!this.kv.has(key) && this.kv.size >= this.maxKeys) {
      throw new CapacityError("maxKeys reached");
    }
    const migrating = this.migrations.has(key);
    this.kv.set(key, value);
    this.log.push({ op: "put", key, value });
    return { owner, migrating };
  }

  get(key: string): unknown {
    this.checkKey(key);
    if (this.migrations.has(key)) {
      throw new StateError(`key ${key} is migrating`);
    }
    return this.kv.get(key);
  }

  ackMigrate(key: string): void {
    this.checkKey(key);
    if (!this.migrations.delete(key)) {
      throw new UnknownError(`no pending migration for ${key}`);
    }
    this.log.push({ op: "ack", key });
  }

  drain(): string[] {
    const keys = [...this.migrations.keys()];
    this.migrations.clear();
    if (keys.length > 0) this.log.push({ op: "drain", keys: [...keys] });
    return keys;
  }

  // ---- queries ----

  vnodeOf(key: string): number {
    this.checkKey(key);
    return hashKey(key) % this.vnodeCount;
  }

  ownerOfVnode(v: number): string | null {
    if (!Number.isInteger(v) || v < 0 || v >= this.vnodeCount) {
      throw new InvalidArgError("vnode index out of range");
    }
    return this.owners[v];
  }

  ownerOf(key: string): string | null {
    return this.ownerOfVnode(this.vnodeOf(key));
  }

  joined(): string[] {
    return [...this.joinedArr];
  }

  pending(): PendingRec[] {
    return [...this.migrations.values()].map((r) => ({ ...r }));
  }

  leaseInfo(node: string): LeaseInfo | null {
    this.checkNode(node);
    const lease = this.validLease(node);
    return lease ? { ...lease } : null;
  }

  journal(): readonly JournalEntry[] {
    return this.log.map(cloneEntry);
  }

  // ---- internals ----

  private checkNode(node: unknown): asserts node is string {
    if (typeof node !== "string" || node.length === 0) {
      throw new InvalidArgError("node must be a non-empty string");
    }
  }

  private checkKey(key: unknown): asserts key is string {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidArgError("key must be a non-empty string");
    }
  }

  private validLease(node: string): LeaseInfo | null {
    const lease = this.leases.get(node);
    if (!lease || lease.expireAt <= this.clock.now()) return null;
    return lease;
  }

  private copyPending(): Map<string, PendingRec> {
    return new Map([...this.migrations].map(([k, r]) => [k, { ...r }]));
  }

  private computeOwners(nodes: string[]): (string | null)[] {
    const owners = new Array<string | null>(this.vnodeCount).fill(null);
    for (let v = 0; v < this.vnodeCount; v++) {
      let best: string | null = null;
      let bestScore = -1;
      for (const n of nodes) {
        const score = hashKey(`${n}#${v}`);
        if (score > bestScore || (score === bestScore && best !== null && n < best)) {
          best = n;
          bestScore = score;
        }
      }
      owners[v] = best;
    }
    return owners;
  }

  private planMembership(newJoined: string[]): Plan {
    const owners = this.computeOwners(newJoined);
    const pending = this.copyPending();
    for (let v = 0; v < this.vnodeCount; v++) {
      const from = this.owners[v];
      const to = owners[v];
      if (from === null || to === null || from === to) continue;
      for (const key of this.kv.keys()) {
        if (hashKey(key) % this.vnodeCount !== v) continue;
        const existing = pending.get(key);
        if (existing) existing.to = to;
        else pending.set(key, { key, from, to });
      }
    }
    return { owners, pending };
  }

  private planLeave(node: string): Plan {
    return this.planMembership(this.joinedArr.filter((n) => n !== node));
  }

  private commitLeave(node: string, plan: Plan): void {
    this.joinedArr = this.joinedArr.filter((n) => n !== node);
    this.owners = plan.owners;
    this.migrations = plan.pending;
  }

  private apply(entry: JournalEntry): void {
    switch (entry.op) {
      case "acquire": {
        this.leases.set(entry.node, {
          fence: entry.fence,
          expireAt: entry.expireAt,
        });
        const prev = this.lastFence.get(entry.node) ?? 0;
        if (entry.fence > prev) this.lastFence.set(entry.node, entry.fence);
        break;
      }
      case "renew": {
        this.leases.set(entry.node, {
          fence: entry.fence,
          expireAt: entry.expireAt,
        });
        break;
      }
      case "release": {
        this.leases.delete(entry.node);
        break;
      }
      case "join": {
        const plan = this.planMembership([...this.joinedArr, entry.node]);
        this.joinedArr.push(entry.node);
        this.owners = plan.owners;
        this.migrations = plan.pending;
        break;
      }
      case "leave": {
        this.commitLeave(entry.node, this.planLeave(entry.node));
        break;
      }
      case "expire": {
        this.leases.delete(entry.node);
        if (this.joinedArr.includes(entry.node)) {
          this.commitLeave(entry.node, this.planLeave(entry.node));
        }
        break;
      }
      case "put": {
        this.kv.set(entry.key, entry.value);
        break;
      }
      case "ack": {
        this.migrations.delete(entry.key);
        break;
      }
      case "drain": {
        for (const key of entry.keys) this.migrations.delete(key);
        break;
      }
    }
  }
}
