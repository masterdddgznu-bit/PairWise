import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidFireError,
  InvalidSpanError,
} from "./errors.js";
import { compareRank, isLive, isSpent } from "./gate.js";
import { FireLedger } from "./ledger.js";
import { Registry, assertValidId, type Saggar } from "./registry.js";

export interface SaggarBedOptions {
  clock: VirtualClock;
  maxSaggars?: number;
  initialCredit?: number;
}

export interface SaggarSnapshot {
  id: string;
  payload: unknown;
  soakAt: number;
  drawAt: number;
  fire: number;
}

export interface FireResult {
  drawn: SaggarSnapshot[];
  spent: string[];
}

function snapshotOf(saggar: Saggar): SaggarSnapshot {
  return {
    id: saggar.id,
    payload: saggar.payload,
    soakAt: saggar.soakAt,
    drawAt: saggar.drawAt,
    fire: saggar.fire,
  };
}

function assertValidSpan(soakAt: unknown, drawAt: unknown): void {
  if (
    typeof soakAt !== "number" ||
    typeof drawAt !== "number" ||
    !Number.isInteger(soakAt) ||
    !Number.isInteger(drawAt) ||
    soakAt < 0 ||
    drawAt < 0 ||
    drawAt <= soakAt
  ) {
    throw new InvalidSpanError("span requires finite integers 0 <= soakAt < drawAt");
  }
}

function assertValidFire(fire: unknown): void {
  if (typeof fire !== "number" || !Number.isInteger(fire) || fire < 1) {
    throw new InvalidFireError("fire must be a finite integer >= 1");
  }
}

export class SaggarBed {
  private readonly clock: VirtualClock;
  private readonly maxSaggars: number;
  private readonly registry = new Registry();
  private readonly ledger: FireLedger;

  constructor(options: SaggarBedOptions) {
    const maxSaggars = options.maxSaggars ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxSaggars) || maxSaggars < 1) {
      throw new InvalidConfigError("maxSaggars must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxSaggars = maxSaggars;
    this.ledger = new FireLedger(initialCredit);
  }

  load(
    id: string,
    payload: unknown,
    soakAt: number,
    drawAt: number,
    fire = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(soakAt, drawAt);
    assertValidFire(fire);
    const existing = this.registry.get(id);
    if (existing) {
      this.registry.update(existing, payload, soakAt, drawAt, fire);
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxSaggars) {
      throw new CapacityError("saggar bed is at capacity");
    }
    this.registry.add(id, payload, soakAt, drawAt, fire);
    return { status: "accepted" };
  }

  retune(id: string, soakAt: number, drawAt: number): boolean {
    assertValidId(id);
    assertValidSpan(soakAt, drawAt);
    const saggar = this.registry.get(id);
    if (!saggar) return false;
    saggar.soakAt = soakAt;
    saggar.drawAt = drawAt;
    this.registry.latch(id);
    return true;
  }

  dump(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  latch(id: string): boolean {
    assertValidId(id);
    this.registry.requireKnown(id);
    this.registry.latch(id);
    return true;
  }

  unlatch(id: string): boolean {
    assertValidId(id);
    this.registry.requireKnown(id);
    this.registry.unlatch(id);
    return true;
  }

  isLatched(id: string): boolean {
    assertValidId(id);
    this.registry.requireKnown(id);
    return this.registry.isLatched(id);
  }

  endow(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): SaggarSnapshot | null {
    const candidates = this.candidates();
    return candidates.length === 0 ? null : snapshotOf(candidates[0]);
  }

  draw(): SaggarSnapshot | null {
    const picked = this.pickAffordable();
    if (!picked) return null;
    this.ledger.spend(picked.fire);
    this.registry.remove(picked.id);
    return snapshotOf(picked);
  }

  liveIds(): string[] {
    return this.candidates().map((s) => s.id);
  }

  fire(): FireResult {
    const now = this.clock.now();
    const drawn: SaggarSnapshot[] = [];
    for (;;) {
      const picked = this.pickAffordable(now);
      if (!picked) break;
      this.ledger.spend(picked.fire);
      this.registry.remove(picked.id);
      drawn.push(snapshotOf(picked));
    }
    const spent: string[] = [];
    for (const saggar of this.registry.ordered()) {
      if (!this.registry.isLatched(saggar.id) && isSpent(saggar, now)) {
        this.registry.remove(saggar.id);
        spent.push(saggar.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { soakAt: number; drawAt: number } | null {
    assertValidId(id);
    const saggar = this.registry.get(id);
    return saggar ? { soakAt: saggar.soakAt, drawAt: saggar.drawAt } : null;
  }

  fireOf(id: string): number | null {
    assertValidId(id);
    const saggar = this.registry.get(id);
    return saggar ? saggar.fire : null;
  }

  private candidates(now: number = this.clock.now()): Saggar[] {
    return this.registry
      .ordered()
      .filter((s) => !this.registry.isLatched(s.id) && isLive(s, now))
      .sort(compareRank);
  }

  private pickAffordable(now: number = this.clock.now()): Saggar | null {
    for (const saggar of this.candidates(now)) {
      if (this.ledger.canAfford(saggar.fire)) return saggar;
    }
    return null;
  }
}
