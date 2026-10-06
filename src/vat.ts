import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { EnzymeLedger } from "./ledger.js";
import {
  Lot,
  LotRegistry,
  validateCost,
  validateId,
  validateSpan,
} from "./registry.js";

export interface RettVatOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialEnzyme?: number;
}

export interface LotView {
  id: string;
  payload: unknown;
  steepAt: number;
  liftAt: number;
  cost: number;
}

export interface DriveResult {
  lifted: LotView[];
  flushed: string[];
}

function viewOf(lot: Lot): LotView {
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
  private readonly registry: LotRegistry;
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
    this.registry = new LotRegistry(maxLots);
    this.ledger = new EnzymeLedger(initialEnzyme);
  }

  steep(
    id: string,
    payload: unknown,
    steepAt: number,
    liftAt: number,
    cost: number = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(steepAt, liftAt);
    validateCost(cost);
    return { status: this.registry.upsert(id, payload, steepAt, liftAt, cost) };
  }

  resteep(id: string, steepAt: number, liftAt: number): boolean {
    validateId(id);
    validateSpan(steepAt, liftAt);
    const lot = this.registry.get(id);
    if (!lot) {
      return false;
    }
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
    this.registry.require(id).sunk = true;
    return true;
  }

  unsink(id: string): boolean {
    validateId(id);
    this.registry.require(id).sunk = false;
    return true;
  }

  isSunk(id: string): boolean {
    validateId(id);
    return this.registry.require(id).sunk;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  enzyme(): number {
    return this.ledger.available();
  }

  peek(): LotView | null {
    const candidate = this.candidates(this.clock.now())[0];
    return candidate ? viewOf(candidate) : null;
  }

  pop(): LotView | null {
    for (const lot of this.candidates(this.clock.now())) {
      if (this.ledger.canAfford(lot.cost)) {
        this.ledger.spend(lot.cost);
        this.registry.remove(lot.id);
        return viewOf(lot);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((lot) => lot.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const lifted: LotView[] = [];
    for (const lot of this.candidates(now)) {
      if (this.ledger.canAfford(lot.cost)) {
        this.ledger.spend(lot.cost);
        this.registry.remove(lot.id);
        lifted.push(viewOf(lot));
      }
    }
    const flushed: string[] = [];
    for (const lot of this.registry.inFirstSteepOrder()) {
      if (!lot.sunk && now >= lot.liftAt) {
        this.registry.remove(lot.id);
        flushed.push(lot.id);
      }
    }
    return { lifted, flushed };
  }

  ids(): string[] {
    return this.registry.inFirstSteepOrder().map((lot) => lot.id);
  }

  size(): number {
    return this.registry.size();
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

  private candidates(now: number): Lot[] {
    return this.registry
      .inFirstSteepOrder()
      .filter(
        (lot) => !lot.sunk && lot.steepAt < now && now < lot.liftAt,
      )
      .sort((a, b) => {
        if (a.cost !== b.cost) return b.cost - a.cost;
        if (a.liftAt !== b.liftAt) return a.liftAt - b.liftAt;
        return a.seq - b.seq;
      });
  }
}
