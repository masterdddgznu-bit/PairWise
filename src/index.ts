import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import { EnzymeLedger } from "./ledger.js";
import {
  Lot,
  LotRegistry,
  compareCandidates,
  isOverretted,
  isRipe,
  validateCost,
  validateId,
  validateSpan,
} from "./registry.js";

export { VirtualClock } from "./clock.js";
export {
  RettVatError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidCostError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

export interface RettVatOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialEnzyme?: number;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  steepAt: number;
  liftAt: number;
  cost: number;
}

function snapshot(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    steepAt: lot.steepAt,
    liftAt: lot.liftAt,
    cost: lot.cost,
  };
}

export class RettVat {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly registry = new LotRegistry();
  private readonly ledger: EnzymeLedger;

  constructor(options: RettVatOptions) {
    const maxLots = options.maxLots ?? 6;
    const initialEnzyme = options.initialEnzyme ?? 0;
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError("maxLots must be an integer >= 1");
    }
    if (!Number.isInteger(initialEnzyme) || initialEnzyme < 0) {
      throw new InvalidConfigError("initialEnzyme must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxLots = maxLots;
    this.ledger = new EnzymeLedger(initialEnzyme);
  }

  steep(
    id: string,
    payload: unknown,
    steepAt: number,
    liftAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(steepAt, liftAt);
    validateCost(cost);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.steepAt = steepAt;
      existing.liftAt = liftAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxLots) {
      throw new CapacityError("vat is at capacity");
    }
    this.registry.add(id, payload, steepAt, liftAt, cost);
    return { status: "accepted" };
  }

  resteep(id: string, steepAt: number, liftAt: number): boolean {
    validateId(id);
    validateSpan(steepAt, liftAt);
    const lot = this.registry.get(id);
    if (!lot) return false;
    lot.steepAt = steepAt;
    lot.liftAt = liftAt;
    return true;
  }

  dump(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  sink(id: string): boolean {
    validateId(id);
    const lot = this.registry.get(id);
    if (!lot) throw new UnknownIdError(`unknown id: ${id}`);
    lot.sunk = true;
    return true;
  }

  unsink(id: string): boolean {
    validateId(id);
    const lot = this.registry.get(id);
    if (!lot) throw new UnknownIdError(`unknown id: ${id}`);
    lot.sunk = false;
    return true;
  }

  isSunk(id: string): boolean {
    validateId(id);
    const lot = this.registry.get(id);
    if (!lot) throw new UnknownIdError(`unknown id: ${id}`);
    return lot.sunk;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  enzyme(): number {
    return this.ledger.available();
  }

  private candidates(now: number): Lot[] {
    return this.registry
      .all()
      .filter((lot) => !lot.sunk && isRipe(lot, now))
      .sort(compareCandidates);
  }

  peek(): LotSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? snapshot(head) : null;
  }

  pop(): LotSnapshot | null {
    for (const lot of this.candidates(this.clock.now())) {
      if (this.ledger.canAfford(lot.cost)) {
        this.ledger.spend(lot.cost);
        this.registry.remove(lot.id);
        return snapshot(lot);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((lot) => lot.id);
  }

  drive(): { lifted: LotSnapshot[]; flushed: string[] } {
    const now = this.clock.now();
    const lifted: LotSnapshot[] = [];
    const flushed: string[] = [];
    for (const lot of this.registry.all()) {
      if (!lot.sunk && isOverretted(lot, now)) {
        this.registry.remove(lot.id);
        flushed.push(lot.id);
      }
    }
    for (;;) {
      const next = this.pop();
      if (!next) break;
      lifted.push(next);
    }
    return { lifted, flushed };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { steepAt: number; liftAt: number } | null {
    validateId(id);
    const lot = this.registry.get(id);
    return lot ? { steepAt: lot.steepAt, liftAt: lot.liftAt } : null;
  }

  costOf(id: string): number | null {
    validateId(id);
    const lot = this.registry.get(id);
    return lot ? lot.cost : null;
  }
}
