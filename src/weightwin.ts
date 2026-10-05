import type { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateIdError,
  InvalidBoostError,
  InvalidConfigError,
  InvalidIdError,
  InvalidPriorityError,
  InvalidWeightError,
  UnknownIdError,
} from "./errors.js";
import { BoostLedger } from "./ledger.js";
import { WindowRegistry, type WindowEntry } from "./registry.js";
import { pickVictim } from "./shed.js";

export interface WeightWinOptions {
  clock: VirtualClock;
  windowMs: number;
  maxSum: number;
}

export interface AddResult {
  status: "accepted";
  shed: string[];
}

export interface BoostResult {
  boostId: number;
}

export interface DriveResult {
  purged: string[];
  expiredBoosts: number[];
  shed: string[];
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export class WeightWin {
  private readonly clock: VirtualClock;
  private readonly windowMs: number;
  private readonly maxSum: number;
  private readonly registry = new WindowRegistry();
  private readonly ledger = new BoostLedger();

  constructor(options: WeightWinOptions) {
    const { clock, windowMs, maxSum } = options ?? ({} as WeightWinOptions);
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("clock with now() is required");
    }
    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new InvalidConfigError("windowMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxSum) || maxSum < 1) {
      throw new InvalidConfigError("maxSum must be an integer >= 1");
    }
    this.clock = clock;
    this.windowMs = windowMs;
    this.maxSum = maxSum;
  }

  add(id: string, weight: number, priority: number): AddResult {
    assertId(id);
    if (!Number.isInteger(weight) || weight < 1) {
      throw new InvalidWeightError("weight must be an integer >= 1");
    }
    if (!Number.isInteger(priority) || priority < 0) {
      throw new InvalidPriorityError("priority must be an integer >= 0");
    }
    this.purge();
    if (this.registry.has(id)) {
      throw new DuplicateIdError(`id already registered: ${id}`);
    }
    if (weight > this.maxSum) {
      throw new CapacityError(`entry weight ${weight} exceeds maxSum ${this.maxSum}`);
    }
    this.registry.add({ id, weight, priority, ts: this.clock.now() });
    const shed = this.shedLoop();
    return { status: "accepted", shed };
  }

  boost(id: string, amount: number, ttlMs: number): BoostResult {
    assertId(id);
    if (!Number.isInteger(amount) || amount < 1 || !Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new InvalidBoostError("amount and ttlMs must be integers >= 1");
    }
    this.purge();
    const entry = this.registry.get(id);
    if (!entry) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    const now = this.clock.now();
    const projected = entry.weight + this.ledger.activeAmountFor(id, now) + amount;
    if (projected > this.maxSum) {
      throw new CapacityError(`boosted effective weight ${projected} exceeds maxSum ${this.maxSum}`);
    }
    const record = this.ledger.add(id, amount, now + ttlMs);
    this.shedLoop();
    return { boostId: record.boostId };
  }

  cancel(id: string): boolean {
    assertId(id);
    this.purge();
    if (!this.registry.remove(id)) return false;
    this.ledger.removeForId(id);
    return true;
  }

  drive(): DriveResult {
    const { purged, expiredBoosts } = this.purge();
    const shed = this.shedLoop();
    return { purged, expiredBoosts, shed };
  }

  sum(): number {
    return this.windowSum(this.clock.now());
  }

  size(): number {
    return this.registry.size();
  }

  ids(): string[] {
    return this.registry.ids();
  }

  inWindowIds(): string[] {
    return this.registry.inWindow(this.clock.now(), this.windowMs).map((entry) => entry.id);
  }

  weightOf(id: string): number | null {
    assertId(id);
    return this.registry.get(id)?.weight ?? null;
  }

  effectiveWeightOf(id: string): number | null {
    assertId(id);
    const entry = this.registry.get(id);
    if (!entry) return null;
    return entry.weight + this.ledger.ledgerAmountFor(id);
  }

  priorityOf(id: string): number | null {
    assertId(id);
    return this.registry.get(id)?.priority ?? null;
  }

  addedAt(id: string): number | null {
    assertId(id);
    return this.registry.get(id)?.ts ?? null;
  }

  activeBoostIds(id: string): number[] {
    assertId(id);
    if (!this.registry.has(id)) return [];
    return this.ledger.boostIdsFor(id);
  }

  /** Expiry cleanup shared by add/boost/cancel/drive: never sheds. */
  private purge(): { purged: string[]; expiredBoosts: number[] } {
    const now = this.clock.now();
    const purged = this.registry.purgeStale(now, this.windowMs);
    for (const id of purged) this.ledger.removeForId(id);
    const expiredBoosts = this.ledger.expire(now);
    return { purged, expiredBoosts };
  }

  private effectiveInWindow(entry: WindowEntry, now: number): number {
    return entry.weight + this.ledger.activeAmountFor(entry.id, now);
  }

  private windowSum(now: number): number {
    let total = 0;
    for (const entry of this.registry.inWindow(now, this.windowMs)) {
      total += this.effectiveInWindow(entry, now);
    }
    return total;
  }

  private shedLoop(): string[] {
    const shed: string[] = [];
    const now = this.clock.now();
    for (;;) {
      if (this.windowSum(now) <= this.maxSum) break;
      const victim = pickVictim(this.registry.inWindow(now, this.windowMs));
      if (!victim) break;
      this.registry.remove(victim.id);
      this.ledger.removeForId(victim.id);
      shed.push(victim.id);
    }
    return shed;
  }
}
