import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidWaterError,
  UnknownIdError,
} from "./errors.js";
import type { VirtualClock } from "./clock.js";
import { WaterLedger } from "./water-ledger.js";
import { CoverGate } from "./cover-gate.js";
import {
  compareByRank,
  snapshotOf,
  LotRegistry,
  type Lot,
  type LotSnapshot,
} from "./lot-registry.js";

export interface SteepCisternOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialWater?: number;
}

export interface DriveResult {
  drawn: LotSnapshot[];
  soaked: string[];
}

const DEFAULT_MAX_LOTS = 5;
const DEFAULT_INITIAL_WATER = 0;

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`invalid lot id: ${String(id)}`);
  }
}

function assertValidSpan(steepAt: unknown, drainAt: unknown): void {
  if (
    typeof steepAt !== "number" ||
    typeof drainAt !== "number" ||
    !Number.isInteger(steepAt) ||
    !Number.isInteger(drainAt) ||
    steepAt < 0 ||
    drainAt < 0 ||
    drainAt <= steepAt
  ) {
    throw new InvalidSpanError(`invalid steep window [${String(steepAt)}, ${String(drainAt)})`);
  }
}

function assertValidWater(water: unknown): void {
  if (typeof water !== "number" || !Number.isInteger(water) || water < 1) {
    throw new InvalidWaterError(`invalid water cost: ${String(water)}`);
  }
}

export class SteepCistern {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly ledger: WaterLedger;
  private readonly registry = new LotRegistry();
  private readonly gate = new CoverGate();

  constructor(options: SteepCisternOptions) {
    const maxLots = options.maxLots ?? DEFAULT_MAX_LOTS;
    const initialWater = options.initialWater ?? DEFAULT_INITIAL_WATER;
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError(`maxLots must be an integer >= 1, got ${String(options.maxLots)}`);
    }
    if (!Number.isInteger(initialWater) || initialWater < 0) {
      throw new InvalidConfigError(`initialWater must be an integer >= 0, got ${String(options.initialWater)}`);
    }
    this.clock = options.clock;
    this.maxLots = maxLots;
    this.ledger = new WaterLedger(initialWater);
  }

  load(
    id: string,
    payload: unknown,
    steepAt: number,
    drainAt: number,
    water = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(steepAt, drainAt);
    assertValidWater(water);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.steepAt = steepAt;
      existing.drainAt = drainAt;
      existing.water = water;
      this.gate.uncover(id);
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxLots) {
      throw new CapacityError(`cistern is full at ${this.maxLots} lots`);
    }
    this.registry.add(id, payload, steepAt, drainAt, water);
    this.gate.cover(id);
    return { status: "accepted" };
  }

  resteep(id: string, steepAt: number, drainAt: number): boolean {
    assertValidId(id);
    assertValidSpan(steepAt, drainAt);
    const lot = this.registry.get(id);
    if (!lot) return false;
    lot.steepAt = steepAt;
    lot.drainAt = drainAt;
    this.gate.uncover(id);
    return true;
  }

  dump(id: string): boolean {
    assertValidId(id);
    if (!this.registry.remove(id)) return false;
    this.gate.clear(id);
    return true;
  }

  cover(id: string): boolean {
    this.requireLot(id);
    this.gate.cover(id);
    return true;
  }

  uncover(id: string): boolean {
    this.requireLot(id);
    this.gate.uncover(id);
    return true;
  }

  isCovered(id: string): boolean {
    this.requireLot(id);
    return this.gate.isCovered(id);
  }

  grant(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError(`invalid grant amount: ${String(amount)}`);
    }
    return this.ledger.grant(amount);
  }

  water(): number {
    return this.ledger.available();
  }

  peek(): LotSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): LotSnapshot | null {
    const target = this.candidates().find((lot) => this.ledger.canAfford(lot.water));
    if (!target) return null;
    this.ledger.spend(target.water);
    this.evict(target.id);
    return snapshotOf(target);
  }

  ripeIds(): string[] {
    return this.candidates().map((lot) => lot.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const soaked: string[] = [];
    for (const lot of this.registry.all()) {
      if (!this.gate.isCovered(lot.id) && this.isSoaked(lot, now)) {
        this.evict(lot.id);
        soaked.push(lot.id);
      }
    }
    const drawn: LotSnapshot[] = [];
    for (;;) {
      const target = this.candidates().find((lot) => this.ledger.canAfford(lot.water));
      if (!target) break;
      this.ledger.spend(target.water);
      this.evict(target.id);
      drawn.push(snapshotOf(target));
    }
    return { drawn, soaked };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { steepAt: number; drainAt: number } | null {
    assertValidId(id);
    const lot = this.registry.get(id);
    return lot ? { steepAt: lot.steepAt, drainAt: lot.drainAt } : null;
  }

  waterOf(id: string): number | null {
    assertValidId(id);
    const lot = this.registry.get(id);
    return lot ? lot.water : null;
  }

  private requireLot(id: string): void {
    assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown lot id: ${id}`);
    }
  }

  private evict(id: string): void {
    this.registry.remove(id);
    this.gate.clear(id);
  }

  // Ripe strictly inside the window: now === steepAt is not yet ripe,
  // now === drainAt is already soaked.
  private isRipe(lot: Lot, now: number): boolean {
    return lot.steepAt < now && now < lot.drainAt;
  }

  private isSoaked(lot: Lot, now: number): boolean {
    return now >= lot.drainAt;
  }

  private candidates(): Lot[] {
    const now = this.clock.now();
    return this.registry
      .all()
      .filter((lot) => !this.gate.isCovered(lot.id) && this.isRipe(lot, now))
      .sort(compareByRank);
  }
}
