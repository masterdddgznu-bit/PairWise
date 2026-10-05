import { VirtualClock } from "./clock.js";
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
import { WindowRegistry, type Entry } from "./registry.js";
import { pickVictim } from "./shed.js";

export interface WeightWinConfig {
  clock: VirtualClock;
  windowMs: number;
  maxSum: number;
}

export class WeightWin {
  private readonly clock: VirtualClock;
  private readonly windowMs: number;
  private readonly maxSum: number;
  private readonly registry = new WindowRegistry();
  private readonly ledger = new BoostLedger();

  constructor(config: WeightWinConfig) {
    if (
      !Number.isInteger(config.windowMs) ||
      config.windowMs < 1 ||
      !Number.isInteger(config.maxSum) ||
      config.maxSum < 1
    ) {
      throw new InvalidConfigError("windowMs and maxSum must be integers >= 1");
    }
    this.clock = config.clock;
    this.windowMs = config.windowMs;
    this.maxSum = config.maxSum;
  }

  add(
    id: string,
    weight: number,
    priority: number,
  ): { status: "accepted"; shed: string[] } {
    this.assertId(id);
    if (!Number.isInteger(weight) || weight < 1) {
      throw new InvalidWeightError("weight must be an integer >= 1");
    }
    if (!Number.isInteger(priority) || priority < 0) {
      throw new InvalidPriorityError("priority must be an integer >= 0");
    }
    this.cleanup();
    if (this.registry.has(id)) {
      throw new DuplicateIdError(`id already registered: ${id}`);
    }
    if (weight > this.maxSum) {
      throw new CapacityError("entry weight alone exceeds maxSum");
    }
    this.registry.add({ id, weight, priority, ts: this.clock.now() });
    const shed = this.shedLoop();
    return { status: "accepted", shed };
  }

  boost(id: string, amount: number, ttlMs: number): { boostId: number } {
    this.assertId(id);
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      !Number.isInteger(ttlMs) ||
      ttlMs < 1
    ) {
      throw new InvalidBoostError("amount and ttlMs must be integers >= 1");
    }
    this.cleanup();
    const entry = this.registry.get(id);
    if (!entry) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    if (this.effectiveOf(entry) + amount > this.maxSum) {
      throw new CapacityError("boosted weight alone exceeds maxSum");
    }
    const boostId = this.ledger.add(id, amount, this.clock.now() + ttlMs);
    this.shedLoop();
    return { boostId };
  }

  cancel(id: string): boolean {
    this.assertId(id);
    this.cleanup();
    if (!this.registry.has(id)) {
      return false;
    }
    this.removeEntry(id);
    return true;
  }

  drive(): { purged: string[]; expiredBoosts: number[]; shed: string[] } {
    const purged: string[] = [];
    const now = this.clock.now();
    for (const entry of this.registry.values()) {
      if (!this.inWindow(entry, now)) {
        this.removeEntry(entry.id);
        purged.push(entry.id);
      }
    }
    const expiredBoosts = this.ledger.expire(now);
    const shed = this.shedLoop();
    return { purged, expiredBoosts, shed };
  }

  sum(): number {
    const now = this.clock.now();
    let total = 0;
    for (const entry of this.registry.values()) {
      if (this.inWindow(entry, now)) {
        total += this.effectiveOf(entry);
      }
    }
    return total;
  }

  size(): number {
    return this.registry.size;
  }

  ids(): string[] {
    return this.registry.values().map((entry) => entry.id);
  }

  inWindowIds(): string[] {
    const now = this.clock.now();
    return this.registry
      .values()
      .filter((entry) => this.inWindow(entry, now))
      .map((entry) => entry.id);
  }

  weightOf(id: string): number | null {
    this.assertId(id);
    return this.registry.get(id)?.weight ?? null;
  }

  effectiveWeightOf(id: string): number | null {
    this.assertId(id);
    const entry = this.registry.get(id);
    if (!entry) return null;
    return this.effectiveOf(entry);
  }

  priorityOf(id: string): number | null {
    this.assertId(id);
    return this.registry.get(id)?.priority ?? null;
  }

  addedAt(id: string): number | null {
    this.assertId(id);
    return this.registry.get(id)?.ts ?? null;
  }

  activeBoostIds(id: string): number[] {
    this.assertId(id);
    if (!this.registry.has(id)) return [];
    return this.ledger.activeFor(id);
  }

  private assertId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private inWindow(entry: Entry, now: number): boolean {
    return now - entry.ts < this.windowMs;
  }

  private effectiveOf(entry: Entry): number {
    return entry.weight + this.ledger.bonusFor(entry.id);
  }

  private removeEntry(id: string): void {
    this.registry.remove(id);
    this.ledger.removeForEntry(id);
  }

  /** Expiry cleanup shared by add/boost/cancel: purge + boost expiry. */
  private cleanup(): void {
    const now = this.clock.now();
    for (const entry of this.registry.values()) {
      if (!this.inWindow(entry, now)) {
        this.removeEntry(entry.id);
      }
    }
    this.ledger.expire(now);
  }

  private shedLoop(): string[] {
    const shed: string[] = [];
    const now = this.clock.now();
    const inWindow = () =>
      this.registry.values().filter((entry) => this.inWindow(entry, now));
    for (;;) {
      const total = inWindow().reduce(
        (acc, entry) => acc + this.effectiveOf(entry),
        0,
      );
      if (total <= this.maxSum) break;
      const victim = pickVictim(inWindow());
      if (!victim) break;
      this.removeEntry(victim.id);
      shed.push(victim.id);
    }
    return shed;
  }
}
