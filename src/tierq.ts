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

export interface Peeked {
  id: string;
  payload: unknown;
  tier: number;
  tenant: string;
}

function requireId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
  return id;
}

function requireIntAtLeast(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new InvalidConfigError(`${name} must be an integer >= ${min}`);
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
    requireIntAtLeast("promoteMs", opts.promoteMs, 1);
    requireIntAtLeast("cooldownMs", opts.cooldownMs, 1);
    const tierCount = opts.tierCount ?? 3;
    const maxItems = opts.maxItems ?? 16;
    const promoteMinSize = opts.promoteMinSize ?? 1;
    requireIntAtLeast("tierCount", tierCount, 2);
    requireIntAtLeast("maxItems", maxItems, 1);
    requireIntAtLeast("promoteMinSize", promoteMinSize, 1);
    this.clock = opts.clock;
    this.promoteMs = opts.promoteMs;
    this.cooldownMs = opts.cooldownMs;
    this.tierCount = tierCount;
    this.maxItems = maxItems;
    this.promoteMinSize = promoteMinSize;
  }

  push(
    id: string,
    payload: unknown,
    tenant?: string,
  ): { status: "accepted" } {
    requireId(id);
    const effectiveTenant = tenant === undefined ? id : requireId(tenant);
    if (this.items.has(id)) {
      throw new DuplicateIdError(`id already present: ${id}`);
    }
    if (this.cooldowns.isActive(id, this.clock.now())) {
      throw new CooldownError(`id is cooling down: ${id}`);
    }
    if (this.items.size >= this.maxItems) {
      throw new CapacityError("queue is full");
    }
    this.items.set(id, {
      id,
      tenant: effectiveTenant,
      payload,
      tier: 0,
      stamp: this.clock.now(),
    });
    return { status: "accepted" };
  }

  cancel(id: string): boolean {
    requireId(id);
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

  peek(): Peeked | null {
    let best: Item | null = null;
    for (const item of this.items.values()) {
      if (best === null || item.tier > best.tier) best = item;
    }
    return best === null ? null : this.view(best);
  }

  pop(): Peeked | null {
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
    requireId(id);
    return this.items.get(id)?.tier ?? null;
  }

  tenantOf(id: string): string | null {
    requireId(id);
    return this.items.get(id)?.tenant ?? null;
  }

  idsInTier(tier: number): string[] {
    if (!Number.isInteger(tier) || tier < 0 || tier >= this.tierCount) {
      throw new InvalidConfigError(
        `tier must be an integer in [0, ${this.tierCount})`,
      );
    }
    const out: string[] = [];
    for (const item of this.items.values()) {
      if (item.tier === tier) out.push(item.id);
    }
    return out;
  }

  cooldownUntil(key: string): number | null {
    requireId(key);
    return this.cooldowns.until(key, this.clock.now());
  }

  private view(item: Item): Peeked {
    return {
      id: item.id,
      payload: item.payload,
      tier: item.tier,
      tenant: item.tenant,
    };
  }
}
