import { VirtualClock } from "./clock.js";
import { CapacityError, InvalidConfigError, UnknownIdError } from "./errors.js";
import { CoverGate } from "./gate.js";
import { SpiritLedger } from "./ledger.js";
import {
  Lot,
  LotRegistry,
  compareLots,
  isRipe,
  isStale,
  validateId,
  validateSpan,
  validateSpirit,
} from "./registry.js";

export interface LotView {
  id: string;
  payload: unknown;
  softenAt: number;
  hardenAt: number;
  spirit: number;
}

export interface ResinPanOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialSpirit?: number;
}

function viewOf(lot: Lot): LotView {
  return {
    id: lot.id,
    payload: lot.payload,
    softenAt: lot.softenAt,
    hardenAt: lot.hardenAt,
    spirit: lot.spirit,
  };
}

export class ResinPan {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly registry = new LotRegistry();
  private readonly gate = new CoverGate();
  private readonly ledger: SpiritLedger;

  constructor(options: ResinPanOptions) {
    const maxLots = options.maxLots ?? 5;
    const initialSpirit = options.initialSpirit ?? 0;
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError("maxLots must be an integer >= 1");
    }
    if (!Number.isInteger(initialSpirit) || initialSpirit < 0) {
      throw new InvalidConfigError("initialSpirit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxLots = maxLots;
    this.ledger = new SpiritLedger(initialSpirit);
  }

  charge(
    id: string,
    payload: unknown,
    softenAt: number,
    hardenAt: number,
    spirit = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(softenAt, hardenAt);
    validateSpirit(spirit);
    const existing = this.registry.get(id);
    if (existing) {
      this.registry.update(existing, payload, softenAt, hardenAt, spirit);
      this.gate.cover(id);
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxLots) {
      throw new CapacityError("resin pan is at capacity");
    }
    this.registry.register(id, payload, softenAt, hardenAt, spirit);
    this.gate.cover(id);
    return { status: "accepted" };
  }

  retune(id: string, softenAt: number, hardenAt: number): boolean {
    validateId(id);
    validateSpan(softenAt, hardenAt);
    const lot = this.registry.get(id);
    if (!lot) return false;
    this.registry.retune(lot, softenAt, hardenAt);
    this.gate.uncover(id);
    return true;
  }

  drop(id: string): boolean {
    validateId(id);
    if (!this.registry.remove(id)) return false;
    this.gate.forget(id);
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
    return this.ledger.grant(amount);
  }

  spirit(): number {
    return this.ledger.available();
  }

  peek(): LotView | null {
    const head = this.candidates()[0];
    return head ? viewOf(head) : null;
  }

  pop(): LotView | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.spirit)) return null;
    this.ledger.spend(head.spirit);
    this.registry.remove(head.id);
    this.gate.forget(head.id);
    return viewOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((lot) => lot.id);
  }

  drive(): { drawn: LotView[]; spent: string[] } {
    const now = this.clock.now();
    const drawn: LotView[] = [];
    for (const lot of this.candidates(now)) {
      if (!this.ledger.canAfford(lot.spirit)) break;
      this.ledger.spend(lot.spirit);
      this.registry.remove(lot.id);
      this.gate.forget(lot.id);
      drawn.push(viewOf(lot));
    }
    const spent: string[] = [];
    for (const lot of this.registry.allInFirstLoadOrder()) {
      if (isStale(lot, now) && !this.gate.isCovered(lot.id)) {
        this.registry.remove(lot.id);
        this.gate.forget(lot.id);
        spent.push(lot.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.allInFirstLoadOrder().map((lot) => lot.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { softenAt: number; hardenAt: number } | null {
    validateId(id);
    const lot = this.registry.get(id);
    if (!lot) return null;
    return { softenAt: lot.softenAt, hardenAt: lot.hardenAt };
  }

  spiritOf(id: string): number | null {
    validateId(id);
    const lot = this.registry.get(id);
    return lot ? lot.spirit : null;
  }

  private candidates(now = this.clock.now()): Lot[] {
    return this.registry
      .allInFirstLoadOrder()
      .filter((lot) => isRipe(lot, now) && !this.gate.isCovered(lot.id))
      .sort(compareLots);
  }

  private requireLot(id: string): Lot {
    validateId(id);
    const lot = this.registry.get(id);
    if (!lot) {
      throw new UnknownIdError(`unknown lot id: ${id}`);
    }
    return lot;
  }
}
