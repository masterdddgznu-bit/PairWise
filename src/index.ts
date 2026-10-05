import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidScoreError,
  UnknownTenantError,
} from "./errors.js";
import { TenantQuotas, type TenantConfig } from "./tenants.js";
import { DeadLetters } from "./deadletter.js";

export { VirtualClock } from "./clock.js";
export {
  DecayQError,
  InvalidConfigError,
  InvalidIdError,
  InvalidScoreError,
  InvalidTenantError,
  CapacityError,
  UnknownIdError,
  UnknownTenantError,
} from "./errors.js";

export interface DecayQOptions {
  clock: VirtualClock;
  maxItems?: number;
  decayPerMs: number;
  defaultTtlMs?: number;
  tenants: TenantConfig[];
}

interface Item {
  id: string;
  tenantId: string;
  payload: unknown;
  baseScore: number;
  enqueuedAt: number;
  deadline: number;
  seq: number;
}

export interface PopResult {
  id: string;
  tenantId: string;
  payload: unknown;
  baseScore: number;
  effectiveScore: number;
}

export class DecayQ {
  private readonly clock: VirtualClock;
  private readonly maxItems: number;
  private readonly decayPerMs: number;
  private readonly defaultTtlMs: number;
  private readonly quotas: TenantQuotas;
  private readonly queued = new Map<string, Item>();
  private readonly inflight = new Map<string, Item>();
  private readonly dead = new DeadLetters<Item>();
  private seqCounter = 0;

  constructor(options: DecayQOptions) {
    if (!options || !(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    this.clock = options.clock;

    const maxItems = options.maxItems ?? 16;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    this.maxItems = maxItems;

    if (
      typeof options.decayPerMs !== "number" ||
      !Number.isFinite(options.decayPerMs) ||
      options.decayPerMs < 0
    ) {
      throw new InvalidConfigError("decayPerMs must be a finite number >= 0");
    }
    this.decayPerMs = options.decayPerMs;

    const defaultTtlMs = options.defaultTtlMs ?? 1000;
    if (!Number.isInteger(defaultTtlMs) || defaultTtlMs < 1) {
      throw new InvalidConfigError("defaultTtlMs must be an integer >= 1");
    }
    this.defaultTtlMs = defaultTtlMs;

    this.quotas = new TenantQuotas(options.tenants);
  }

  enqueue(
    id: string,
    tenantId: string,
    payload: unknown,
    baseScore: number,
    ttlMs?: number,
  ): { status: "queued" } {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    if (!this.quotas.has(tenantId)) {
      throw new UnknownTenantError(`unknown tenant: ${tenantId}`);
    }
    if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) {
      throw new InvalidScoreError("baseScore must be a finite number");
    }
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (!Number.isInteger(ttl) || ttl < 1) {
      throw new InvalidConfigError("ttlMs must be an integer >= 1");
    }
    if (this.queued.has(id) || this.inflight.has(id)) {
      throw new InvalidIdError(`duplicate id: ${id}`);
    }
    this.sweep();
    if (this.queued.size >= this.maxItems) {
      throw new CapacityError("queue is full");
    }
    const now = this.clock.now();
    this.queued.set(id, {
      id,
      tenantId,
      payload,
      baseScore,
      enqueuedAt: now,
      deadline: now + ttl,
      seq: this.seqCounter++,
    });
    return { status: "queued" };
  }

  cancel(id: string): boolean {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    if (this.queued.has(id)) {
      this.queued.delete(id);
      return true;
    }
    return false;
  }

  pop(): PopResult | null {
    const picked = this.pick();
    if (!picked) return null;
    this.queued.delete(picked.item.id);
    this.inflight.set(picked.item.id, picked.item);
    this.quotas.recordPop(picked.item.tenantId);
    return this.snapshot(picked.item, picked.effectiveScore);
  }

  peek(): PopResult | null {
    const picked = this.pick();
    if (!picked) return null;
    return this.snapshot(picked.item, picked.effectiveScore);
  }

  complete(id: string): boolean {
    const item = this.inflight.get(id);
    if (!item) return false;
    this.inflight.delete(id);
    this.quotas.recordComplete(item.tenantId);
    return true;
  }

  pump(): { expired: string[] } {
    return { expired: this.sweep() };
  }

  drive(limit?: number): { drained: PopResult[] } {
    const max = limit ?? Number.POSITIVE_INFINITY;
    const drained: PopResult[] = [];
    while (drained.length < max) {
      const next = this.pop();
      if (!next) break;
      drained.push(next);
    }
    return { drained };
  }

  refuseQuota(id: string): boolean {
    const item = this.queued.get(id);
    if (!item) return false;
    this.queued.delete(id);
    this.dead.add(item, "quota_refuse");
    return true;
  }

  reclaim(id: string): boolean {
    if (!this.dead.has(id)) return false;
    if (this.queued.size >= this.maxItems) return false;
    const item = this.dead.take(id);
    if (!item) return false;
    const now = this.clock.now();
    item.enqueuedAt = now;
    item.deadline = now + this.defaultTtlMs;
    this.queued.set(id, item);
    return true;
  }

  deadLetterIds(): string[] {
    return this.dead.ids();
  }

  deadReason(id: string): "expired" | "quota_refuse" | null {
    return this.dead.reason(id);
  }

  size(): number {
    return this.queued.size;
  }

  inflightOf(tenantId: string): number {
    return this.quotas.inflightOf(tenantId);
  }

  popsOf(tenantId: string): number {
    return this.quotas.popsOf(tenantId);
  }

  effectiveScore(id: string): number | null {
    const item = this.queued.get(id);
    if (!item) return null;
    return this.scoreOf(item);
  }

  ids(): string[] {
    return [...this.queued.keys()];
  }

  private scoreOf(item: Item): number {
    return (
      item.baseScore - this.decayPerMs * (this.clock.now() - item.enqueuedAt)
    );
  }

  private snapshot(item: Item, effectiveScore: number): PopResult {
    return {
      id: item.id,
      tenantId: item.tenantId,
      payload: item.payload,
      baseScore: item.baseScore,
      effectiveScore,
    };
  }

  private sweep(): string[] {
    const now = this.clock.now();
    const expired: string[] = [];
    for (const [id, item] of this.queued) {
      if (now >= item.deadline) {
        expired.push(id);
        this.dead.add(item, "expired");
      }
    }
    for (const id of expired) {
      this.queued.delete(id);
    }
    return expired;
  }

  private pick(): { item: Item; effectiveScore: number } | null {
    this.sweep();
    const candidates = [...this.queued.values()]
      .map((item) => ({ item, effectiveScore: this.scoreOf(item) }))
      .sort((a, b) => {
        if (b.effectiveScore !== a.effectiveScore) {
          return b.effectiveScore - a.effectiveScore;
        }
        if (a.item.enqueuedAt !== b.item.enqueuedAt) {
          return a.item.enqueuedAt - b.item.enqueuedAt;
        }
        return a.item.seq - b.item.seq;
      });
    for (const candidate of candidates) {
      if (this.quotas.canPop(candidate.item.tenantId)) {
        return candidate;
      }
    }
    return null;
  }
}
