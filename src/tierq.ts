import { VirtualClock } from "./clock.js";
import { CooldownRegistry } from "./cooldown.js";
import {
  CapacityError,
  CooldownError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
} from "./errors.js";

export interface TierQOptions {
  clock: VirtualClock;
  promoteMs: number;
  cooldownMs: number;
  tierCount?: number;
  maxItems?: number;
  promoteMinSize?: number;
}

interface Item {
  id: string;
  tenant: string;
  payload: unknown;
  tier: number;
  stamp: number;
}

export interface PeekResult {
  id: string;
  payload: unknown;
  tier: number;
  tenant: string;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`id must be a non-empty string, got ${String(id)}`);
  }
}

export class TierQ {
  private readonly clock: VirtualClock;
  private readonly promoteMs: number;
  private readonly cooldownMs: number;
  private readonly tierCount: number;
  private readonly maxItems: number;
  private readonly promoteMinSize: number;
  private readonly items = new Map<string, Item>();
  private readonly cooldowns = new CooldownRegistry();

  constructor(opts: TierQOptions) {
    if (!isPositiveInt(opts.promoteMs) || !isPositiveInt(opts.cooldownMs)) {
      throw new InvalidConfigError("promoteMs and cooldownMs must be integers >= 1");
    }
    const tierCount = opts.tierCount ?? 3;
    const maxItems = opts.maxItems ?? 16;
    const promoteMinSize = opts.promoteMinSize ?? 1;
    if (!Number.isInteger(tierCount) || tierCount < 2) {
      throw new InvalidConfigError("tierCount must be an integer >= 2");
    }
    if (!isPositiveInt(maxItems)) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    if (!isPositiveInt(promoteMinSize)) {
      throw new InvalidConfigError("promoteMinSize must be an integer >= 1");
    }
    this.clock = opts.clock;
    this.promoteMs = opts.promoteMs;
    this.cooldownMs = opts.cooldownMs;
    this.tierCount = tierCount;
    this.maxItems = maxItems;
    this.promoteMinSize = promoteMinSize;
  }

  push(id: string, payload: unknown, tenant?: string): { status: "accepted" } {
    assertValidId(id);
    const effectiveTenant = tenant === undefined ? id : tenant;
    if (typeof effectiveTenant !== "string" || effectiveTenant.length === 0) {
      throw new InvalidIdError("tenant must be a non-empty string");
    }
    if (this.items.has(id)) {
      throw new DuplicateIdError(`id already present: ${id}`);
    }
    const now = this.clock.now();
    if (this.cooldowns.isActive(id, now)) {
      throw new CooldownError(`id is cooling down: ${id}`);
    }
    if (this.items.size >= this.maxItems) {
      throw new CapacityError(`queue is full (${this.maxItems})`);
    }
    this.items.set(id, {
      id,
      tenant: effectiveTenant,
      payload,
      tier: 0,
      stamp: now,
    });
    return { status: "accepted" };
  }

  cancel(id: string): boolean {
    assertValidId(id);
    return this.items.delete(id);
  }

  drive(): { promoted: string[]; cooledSkipped: string[] } {
    const now = this.clock.now();
    const tierSizes = new Array<number>(this.tierCount).fill(0);
    for (const item of this.items.values()) {
      tierSizes[item.tier] += 1;
    }
    const promoted: string[] = [];
    const cooledSkipped: string[] = [];
    const cooledSeen = new Set<string>();
    for (const item of this.items.values()) {
      if (item.tier >= this.tierCount - 1) continue;
      if (now < item.stamp + this.promoteMs) continue;
      if (
        this.cooldowns.isActive(item.id, now) ||
        this.cooldowns.isActive(item.tenant, now)
      ) {
        if (!cooledSeen.has(item.id)) {
          cooledSeen.add(item.id);
          cooledSkipped.push(item.id);
        }
        continue;
      }
      if (tierSizes[item.tier] < this.promoteMinSize) continue;
      item.tier += 1;
      item.stamp = now;
      promoted.push(item.id);
    }
    return { promoted, cooledSkipped };
  }

  peek(): PeekResult | null {
    let best: Item | null = null;
    for (const item of this.items.values()) {
      if (best === null || item.tier > best.tier) best = item;
    }
    if (best === null) return null;
    return {
      id: best.id,
      payload: best.payload,
      tier: best.tier,
      tenant: best.tenant,
    };
  }

  pop(): PeekResult | null {
    const top = this.peek();
    if (top === null) return null;
    this.items.delete(top.id);
    const until = this.clock.now() + this.cooldownMs;
    this.cooldowns.register(top.id, until);
    this.cooldowns.register(top.tenant, until);
    return top;
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  size(): number {
    return this.items.size;
  }

  tierOf(id: string): number | null {
    assertValidId(id);
    return this.items.get(id)?.tier ?? null;
  }

  tenantOf(id: string): string | null {
    assertValidId(id);
    return this.items.get(id)?.tenant ?? null;
  }

  idsInTier(tier: number): string[] {
    if (!Number.isInteger(tier) || tier < 0 || tier >= this.tierCount) {
      throw new InvalidConfigError(`tier must be an integer in [0, ${this.tierCount})`);
    }
    const result: string[] = [];
    for (const item of this.items.values()) {
      if (item.tier === tier) result.push(item.id);
    }
    return result;
  }

  cooldownUntil(key: string): number | null {
    assertValidId(key);
    return this.cooldowns.until(key, this.clock.now());
  }
}
