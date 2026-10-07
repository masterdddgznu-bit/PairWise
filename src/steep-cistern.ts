import { VirtualClock } from "./clock.js";
import {
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidWaterError,
  UnknownIdError,
} from "./errors.js";
import { AirRestGate } from "./gate.js";
import { WaterLedger } from "./ledger.js";
import { Lot, LotRegistry } from "./registry.js";

export interface SteepCisternOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialWater?: number;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  steepAt: number;
  drainAt: number;
  water: number;
}

export interface DriveResult {
  drawn: LotSnapshot[];
  soaked: string[];
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function snapshotOf(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    steepAt: lot.steepAt,
    drainAt: lot.drainAt,
    water: lot.water,
  };
}

export class SteepCistern {
  #clock: VirtualClock;
  #registry: LotRegistry;
  #gate = new AirRestGate();
  #ledger: WaterLedger;

  constructor(options: SteepCisternOptions) {
    const maxLots = options?.maxLots ?? 5;
    const initialWater = options?.initialWater ?? 0;
    if (
      !options ||
      !options.clock ||
      typeof options.clock.now !== "function" ||
      !isPositiveInt(maxLots) ||
      !isNonNegativeInt(initialWater)
    ) {
      throw new InvalidConfigError("invalid cistern configuration");
    }
    this.#clock = options.clock;
    this.#registry = new LotRegistry(maxLots);
    this.#ledger = new WaterLedger(initialWater);
  }

  #requireValidId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  #requireKnownId(id: unknown): string {
    this.#requireValidId(id);
    if (!this.#registry.has(id)) {
      throw new UnknownIdError(`unknown lot: ${id}`);
    }
    return id;
  }

  #requireValidSpan(steepAt: unknown, drainAt: unknown): void {
    if (
      !isNonNegativeInt(steepAt) ||
      !isNonNegativeInt(drainAt) ||
      drainAt <= steepAt
    ) {
      throw new InvalidSpanError("span must be integers with 0 <= steepAt < drainAt");
    }
  }

  #requireValidWater(water: unknown): void {
    if (!isPositiveInt(water)) {
      throw new InvalidWaterError("water must be an integer >= 1");
    }
  }

  load(
    id: string,
    payload: unknown,
    steepAt: number,
    drainAt: number,
    water = 1,
  ): { status: "accepted" | "updated" } {
    this.#requireValidId(id);
    this.#requireValidSpan(steepAt, drainAt);
    this.#requireValidWater(water);
    const status = this.#registry.upsert(id, payload, steepAt, drainAt, water);
    if (status === "accepted") {
      this.#gate.cover(id);
    } else {
      this.#gate.uncover(id);
    }
    return { status };
  }

  resteep(id: string, steepAt: number, drainAt: number): boolean {
    this.#requireValidId(id);
    this.#requireValidSpan(steepAt, drainAt);
    const lot = this.#registry.get(id);
    if (!lot) {
      return false;
    }
    lot.steepAt = steepAt;
    lot.drainAt = drainAt;
    this.#gate.uncover(id);
    return true;
  }

  dump(id: string): boolean {
    this.#requireValidId(id);
    if (!this.#registry.remove(id)) {
      return false;
    }
    this.#gate.forget(id);
    return true;
  }

  cover(id: string): boolean {
    this.#gate.cover(this.#requireKnownId(id));
    return true;
  }

  uncover(id: string): boolean {
    this.#gate.uncover(this.#requireKnownId(id));
    return true;
  }

  isCovered(id: string): boolean {
    return this.#gate.isCovered(this.#requireKnownId(id));
  }

  grant(amount: number): number {
    if (!isPositiveInt(amount)) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.#ledger.grant(amount);
  }

  water(): number {
    return this.#ledger.balance();
  }

  #isLive(lot: Lot, now: number): boolean {
    return lot.steepAt < now && now < lot.drainAt;
  }

  #isSoaked(lot: Lot, now: number): boolean {
    return now >= lot.drainAt;
  }

  #candidates(now: number): Lot[] {
    return this.#registry
      .entries()
      .filter((lot) => !this.#gate.isCovered(lot.id) && this.#isLive(lot, now))
      .sort(
        (a, b) =>
          b.drainAt - a.drainAt || a.water - b.water || a.seq - b.seq,
      );
  }

  peek(): LotSnapshot | null {
    const head = this.#candidates(this.#clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): LotSnapshot | null {
    for (const lot of this.#candidates(this.#clock.now())) {
      if (this.#ledger.canAfford(lot.water)) {
        this.#ledger.spend(lot.water);
        this.#registry.remove(lot.id);
        this.#gate.forget(lot.id);
        return snapshotOf(lot);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.#candidates(this.#clock.now()).map((lot) => lot.id);
  }

  drive(): DriveResult {
    const now = this.#clock.now();
    const soaked: string[] = [];
    for (const lot of this.#registry.entries()) {
      if (!this.#gate.isCovered(lot.id) && this.#isSoaked(lot, now)) {
        soaked.push(lot.id);
      }
    }
    for (const id of soaked) {
      this.#registry.remove(id);
      this.#gate.forget(id);
    }
    const drawn: LotSnapshot[] = [];
    for (const lot of this.#candidates(now)) {
      if (this.#ledger.canAfford(lot.water)) {
        this.#ledger.spend(lot.water);
        this.#registry.remove(lot.id);
        this.#gate.forget(lot.id);
        drawn.push(snapshotOf(lot));
      }
    }
    return { drawn, soaked };
  }

  ids(): string[] {
    return this.#registry.entries().map((lot) => lot.id);
  }

  size(): number {
    return this.#registry.size();
  }

  spanOf(id: string): { steepAt: number; drainAt: number } | null {
    this.#requireValidId(id);
    const lot = this.#registry.get(id);
    return lot ? { steepAt: lot.steepAt, drainAt: lot.drainAt } : null;
  }

  waterOf(id: string): number | null {
    this.#requireValidId(id);
    return this.#registry.get(id)?.water ?? null;
  }
}
