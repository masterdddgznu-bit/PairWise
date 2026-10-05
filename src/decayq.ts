import { VirtualClock } from "./clock.js";
import { DeadLetterStore, DeadReason } from "./deadletter.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidScoreError,
  UnknownTenantError,
} from "./errors.js";
import { TenantConfig, TenantRegistry } from "./tenants.js";

export interface DecayQConfig {
  clock: VirtualClock;
  maxItems?: number;
  decayPerMs: number;
  defaultTtlMs?: number;
  tenants: TenantConfig[];
}

export interface PopSnapshot {
  id: string;
  tenantId: string;
  payload: unknown;
  baseScore: number;
  effectiveScore: number;
}

type ItemStatus = "queued" | "inflight";

interface Item {
  id: string;
  tenantId: string;
  payload: unknown;
  baseScore: number;
  enqueuedAt: number;
  deadline: number;
  seq: number;
  status: ItemStatus;
}

export class DecayQ {
  private readonly clock: VirtualClock;
  private readonly maxItems: number;
  private readonly decayPerMs: number;
  private readonly defaultTtlMs: number;
  private readonly tenants: TenantRegistry;
  private readonly dead: DeadLetterStore;
  private readonly items = new Map<string, Item>();
  private readonly deadItems = new Map<string, Item>();
  private seqCounter = 0;

  constructor(config: DecayQConfig) {
    if (!config || typeof config !== "object") {
      throw new InvalidConfigError("config is required");
    }
    const clock = config.clock;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    const maxItems = config.maxItems ?? 16;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    const decayPerMs = config.decayPerMs;
    if (
      typeof decayPerMs !== "number" ||
      !Number.isFinite(decayPerMs) ||
      decayPerMs < 0
    ) {
      throw new InvalidConfigError("decayPerMs must be a finite number >= 0");
    }
    const defaultTtlMs = config.defaultTtlMs ?? 1000;
    if (!Number.isInteger(defaultTtlMs) || defaultTtlMs < 1) {
      throw new InvalidConfigError("defaultTtlMs must be an integer >= 1");
    }
    this.clock = clock;
    this.maxItems = maxItems;
    this.decayPerMs = decayPerMs;
    this.defaultTtlMs = defaultTtlMs;
    this.tenants = new TenantRegistry(config.tenants);
    this.dead = new DeadLetterStore();
  }

  enqueue(
    id: string,
    tenantId: string,
    payload: unknown,
    baseScore: number,
    ttlMs?: number,
  ): { status: "queued" } {
    this.sweep();
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    if (this.items.has(id)) {
      throw new InvalidIdError(`duplicate id: ${id}`);
    }
    if (!this.tenants.has(tenantId)) {
      throw new UnknownTenantError(`unknown tenant: ${tenantId}`);
    }
    if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) {
      throw new InvalidScoreError("baseScore must be a finite number");
    }
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (!Number.isInteger(ttl) || ttl < 1) {
      throw new InvalidConfigError("ttlMs must be an integer >= 1");
    }
    if (this.queuedCount() >= this.maxItems) {
      throw new CapacityError("queue is full");
    }
    const now = this.clock.now();
    this.items.set(id, {
      id,
      tenantId,
      payload,
      baseScore,
      enqueuedAt: now,
      deadline: now + ttl,
      seq: this.seqCounter++,
      status: "queued",
    });
    return { status: "queued" };
  }

  cancel(id: string): boolean {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    const item = this.items.get(id);
    if (!item || item.status !== "queued") {
      return false;
    }
    this.items.delete(id);
    return true;
  }

  pop(): PopSnapshot | null {
    this.sweep();
    const candidate = this.select();
    if (!candidate) {
      return null;
    }
    candidate.status = "inflight";
    this.tenants.recordPop(candidate.tenantId);
    return this.snapshot(candidate);
  }

  peek(): PopSnapshot | null {
    this.sweep();
    const candidate = this.select();
    return candidate ? this.snapshot(candidate) : null;
  }

  complete(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.status !== "inflight") {
      return false;
    }
    this.items.delete(id);
    this.tenants.recordComplete(item.tenantId);
    return true;
  }

  pump(): { expired: string[] } {
    const expired: string[] = [];
    const now = this.clock.now();
    for (const item of this.queuedBySeq()) {
      if (now >= item.deadline) {
        this.kill(item, "expired");
        expired.push(item.id);
      }
    }
    return { expired };
  }

  drive(limit?: number): { drained: PopSnapshot[] } {
    const drained: PopSnapshot[] = [];
    const max = limit ?? Number.POSITIVE_INFINITY;
    while (drained.length < max) {
      const next = this.pop();
      if (!next) break;
      drained.push(next);
    }
    return { drained };
  }

  refuseQuota(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.status !== "queued") {
      return false;
    }
    this.kill(item, "quota_refuse");
    return true;
  }

  reclaim(id: string): boolean {
    if (!this.dead.has(id)) {
      return false;
    }
    if (this.queuedCount() >= this.maxItems) {
      return false;
    }
    const item = this.deadItems.get(id);
    if (!item) {
      return false;
    }
    const now = this.clock.now();
    item.enqueuedAt = now;
    item.deadline = now + this.defaultTtlMs;
    item.seq = this.seqCounter++;
    item.status = "queued";
    this.deadItems.delete(id);
    this.dead.remove(id);
    this.items.set(id, item);
    return true;
  }

  deadLetterIds(): string[] {
    return this.dead.ids();
  }

  deadReason(id: string): DeadReason | null {
    return this.dead.reasonOf(id);
  }

  size(): number {
    return this.queuedCount();
  }

  inflightOf(tenantId: string): number {
    return this.tenants.inflightOf(tenantId);
  }

  popsOf(tenantId: string): number {
    return this.tenants.popsOf(tenantId);
  }

  effectiveScore(id: string): number | null {
    const item = this.items.get(id);
    if (!item || item.status !== "queued") {
      return null;
    }
    return this.scoreOf(item);
  }

  ids(): string[] {
    return this.queuedBySeq().map((item) => item.id);
  }

  private sweep(): void {
    this.pump();
  }

  private kill(item: Item, reason: DeadReason): void {
    this.items.delete(item.id);
    this.deadItems.set(item.id, item);
    this.dead.add(item.id, reason);
  }

  private scoreOf(item: Item): number {
    return (
      item.baseScore - this.decayPerMs * (this.clock.now() - item.enqueuedAt)
    );
  }

  private snapshot(item: Item): PopSnapshot {
    return {
      id: item.id,
      tenantId: item.tenantId,
      payload: item.payload,
      baseScore: item.baseScore,
      effectiveScore: this.scoreOf(item),
    };
  }

  private select(): Item | null {
    const now = this.clock.now();
    const ranked = this.queuedBySeq().sort((a, b) => {
      const scoreA = a.baseScore - this.decayPerMs * (now - a.enqueuedAt);
      const scoreB = b.baseScore - this.decayPerMs * (now - b.enqueuedAt);
      if (scoreA !== scoreB) return scoreB - scoreA;
      if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
      return a.seq - b.seq;
    });
    for (const item of ranked) {
      if (this.tenants.canPop(item.tenantId)) {
        return item;
      }
    }
    return null;
  }

  private queuedBySeq(): Item[] {
    return [...this.items.values()]
      .filter((item) => item.status === "queued")
      .sort((a, b) => a.seq - b.seq);
  }

  private queuedCount(): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.status === "queued") count += 1;
    }
    return count;
  }
}
